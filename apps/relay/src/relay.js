import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { sign, verify } from "./token.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const INFO_TTL_MS = 60_000;
const MAX_INFLIGHT_PER_MINER = 8;
const SESSION_TTL_SECONDS = 3600;
const COOKIE_NAME = "__ra";
const HEARTBEAT_MS = 20_000;

// Cabeçalhos que não atravessam o proxy (hop-by-hop) ou que o próprio relay recalcula.
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding", "content-encoding"]);

function page(res, status, title, message) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;background:#090d13;color:#e8eef9;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh">
<div style="max-width:440px;padding:28px;text-align:center"><p style="color:#42dba3;font-size:11px;font-weight:700;letter-spacing:.1em;margin:0 0 8px">ASIC MONITOR CLOUD</p>
<h1 style="font-size:20px;margin:0 0 10px">${title}</h1><p style="color:#94a3b8;font-size:14px;line-height:1.5;margin:0">${message}</p></div></body>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

export function createRelay(config) {
  const { supabaseUrl, serviceKey, pepper, secret, baseDomain } = config;
  const log = config.log ?? console;
  const requestTimeoutMs = config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  /** farmId -> { ws, pending: Map<frameId, {resolve, reject, timer, minerId}>, inflight: Map<minerId, number> } */
  const agents = new Map();
  /** minerId -> { at, info } */
  const infoCache = new Map();
  /** nonce -> expira em (ms): link de uso único */
  const usedNonces = new Map();

  async function rest(path) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
    if (!response.ok) throw new Error(`supabase ${response.status}`);
    return response.json();
  }

  /** Máquina + fazenda (com o interruptor de acesso remoto), em cache curto: desligar o acesso vale em até 1 min. */
  async function minerInfo(minerId) {
    const cached = infoCache.get(minerId);
    if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.info;
    let info = null;
    try {
      const rows = await rest(`miners?id=eq.${encodeURIComponent(minerId)}&select=id,enabled,ip,web_port,farm:farms(id,organization_id,remote_access_enabled)`);
      const row = rows[0];
      if (row?.farm) info = { id: row.id, enabled: row.enabled, ip: row.ip, webPort: row.web_port, farmId: row.farm.id, organizationId: row.farm.organization_id, remoteEnabled: row.farm.remote_access_enabled };
    } catch (error) {
      log.error("relay: falha ao consultar máquina", minerId, error.message);
      if (cached) return cached.info; // melhor manter o último estado conhecido do que derrubar tudo
      throw error;
    }
    infoCache.set(minerId, { at: Date.now(), info });
    return info;
  }

  async function authenticateAgent(token) {
    const hash = createHash("sha256").update(`${token}${pepper}`).digest("hex");
    const rows = await rest(`agents?token_hash=eq.${hash}&select=id,farm_id`);
    return rows[0] ? { agentId: rows[0].id, farmId: rows[0].farm_id } : null;
  }

  // ---------- lado do coletor (WebSocket) ----------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024 });

  function failPending(entry, message, code) {
    for (const [id, pending] of entry.pending) { clearTimeout(pending.timer); pending.reject(Object.assign(new Error(message), { code })); entry.pending.delete(id); }
  }

  function onAgentConnection(ws, { agentId, farmId }) {
    const previous = agents.get(farmId);
    if (previous) { failPending(previous, "Coletor reconectou.", "agent_replaced"); previous.ws.close(4000, "replaced"); }
    const entry = { ws, agentId, pending: new Map(), inflight: new Map(), alive: true };
    agents.set(farmId, entry);
    log.info?.(`relay: coletor conectado (fazenda ${farmId})`);
    ws.on("pong", () => { entry.alive = true; });
    ws.on("message", (data) => {
      let frame;
      try { frame = JSON.parse(data.toString("utf8")); } catch { return; }
      const pending = frame?.id ? entry.pending.get(frame.id) : null;
      if (!pending) return;
      clearTimeout(pending.timer);
      entry.pending.delete(frame.id);
      if (frame.t === "res") pending.resolve(frame);
      else pending.reject(Object.assign(new Error(frame.message ?? "Falha no coletor."), { code: frame.code ?? "agent_error" }));
    });
    ws.on("close", () => {
      failPending(entry, "Coletor desconectou.", "agent_offline");
      if (agents.get(farmId) === entry) agents.delete(farmId);
      log.info?.(`relay: coletor desconectado (fazenda ${farmId})`);
    });
    ws.on("error", () => {});
  }

  const heartbeat = setInterval(() => {
    for (const [farmId, entry] of agents) {
      if (!entry.alive) { entry.ws.terminate(); agents.delete(farmId); continue; }
      entry.alive = false;
      try { entry.ws.ping(); } catch { /* fecha no próximo ciclo */ }
    }
    const now = Date.now();
    for (const [nonce, expires] of usedNonces) if (expires < now) usedNonces.delete(nonce);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  function forwardToAgent(entry, frame, minerId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { entry.pending.delete(frame.id); reject(Object.assign(new Error("A máquina demorou demais para responder."), { code: "timeout" })); }, requestTimeoutMs);
      entry.pending.set(frame.id, { resolve, reject, timer, minerId });
      try { entry.ws.send(JSON.stringify(frame)); } catch (error) { clearTimeout(timer); entry.pending.delete(frame.id); reject(error); }
    });
  }

  // ---------- lado do navegador (HTTP) ----------

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function handle(req, res) {
    const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
    const url = new URL(req.url ?? "/", "http://relay.local");
    if (url.pathname === "/__health") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); return; }

    const match = host.match(/^m-([0-9a-f-]{36})\.(.+)$/);
    if (!match || match[2] !== baseDomain) return page(res, 404, "Endereço não encontrado", "Abra a máquina pelo botão Acessar máquina no painel.");
    const minerId = match[1];
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") return page(res, 501, "Recurso não suportado", "Esta tela usa WebSocket, que ainda não é suportado no acesso remoto.");

    let info;
    try { info = await minerInfo(minerId); } catch { return page(res, 503, "Serviço indisponível", "Não foi possível consultar a máquina agora. Tente novamente em instantes."); }
    if (!info || !info.enabled) return page(res, 404, "Máquina não encontrada", "Esta máquina não existe ou foi removida.");
    if (!info.remoteEnabled) return page(res, 403, "Acesso remoto desligado", "O acesso remoto está desligado nesta fazenda. Ligue-o no painel (Telemetria).");

    // 1) Link de uso único vindo do painel: troca por cookie de sessão e limpa a URL.
    const linkToken = url.searchParams.get("t");
    if (linkToken) {
      const payload = verify(linkToken, secret);
      if (!payload || payload.k !== "t" || payload.m !== minerId || payload.o !== info.organizationId) return page(res, 401, "Link inválido ou expirado", "Abra a máquina de novo pelo botão Acessar máquina no painel.");
      if (usedNonces.has(payload.n)) return page(res, 401, "Link já utilizado", "Este link só funciona uma vez. Abra a máquina de novo pelo painel.");
      usedNonces.set(payload.n, payload.exp * 1000 + 60_000);
      const session = sign({ k: "s", m: minerId, o: payload.o, u: payload.u, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }, secret);
      url.searchParams.delete("t");
      res.writeHead(302, { location: `${url.pathname}${url.search}`, "set-cookie": `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`, "cache-control": "no-store" });
      res.end();
      return;
    }

    // 2) Sessão por cookie
    const session = verify(parseCookies(req.headers.cookie)[COOKIE_NAME], secret);
    if (!session || session.k !== "s" || session.m !== minerId || session.o !== info.organizationId) return page(res, 401, "Sessão expirada", "Abra a máquina de novo pelo botão Acessar máquina no painel.");

    const entry = agents.get(info.farmId);
    if (!entry) return page(res, 502, "Coletor offline", "O coletor desta fazenda não está conectado ao acesso remoto. Confira se o computador da fazenda está ligado e com o coletor aberto (versão 0.11 ou superior).");
    const inflight = entry.inflight.get(minerId) ?? 0;
    if (inflight >= MAX_INFLIGHT_PER_MINER) return page(res, 429, "Muitas requisições", "A máquina está processando muitas requisições ao mesmo tempo. Aguarde um instante.");

    const path = req.url ?? "/";
    if (!path.startsWith("/")) return page(res, 400, "Requisição inválida", "Caminho inválido.");
    const body = await readBody(req);
    if (body === null) return page(res, 413, "Requisição muito grande", "O envio passa de 10 MB, o limite do acesso remoto.");

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP_HEADERS.has(name) || value === undefined) continue;
      if (name === "cookie") {
        const kept = String(value).split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith(`${COOKIE_NAME}=`)).join("; ");
        if (kept) headers.cookie = kept;
        continue;
      }
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const frame = { t: "req", id: randomUUID(), miner_id: minerId, method: req.method, path, headers, body_b64: body.length ? body.toString("base64") : "", public_origin: `https://${host}` };

    entry.inflight.set(minerId, inflight + 1);
    try {
      const reply = await forwardToAgent(entry, frame, minerId);
      const outHeaders = {};
      const setCookies = [];
      for (const [name, value] of reply.headers ?? []) {
        const lower = String(name).toLowerCase();
        if (HOP_HEADERS.has(lower)) continue;
        if (lower === "set-cookie") { setCookies.push(String(value).replace(/;\s*domain=[^;]*/i, "")); continue; }
        if (lower === "location") { outHeaders[lower] = rewriteLocation(String(value), info, `https://${host}`); continue; }
        outHeaders[lower] = outHeaders[lower] ? `${outHeaders[lower]}, ${value}` : String(value);
      }
      if (setCookies.length) outHeaders["set-cookie"] = setCookies;
      outHeaders["cache-control"] ??= "no-store";
      outHeaders["referrer-policy"] = "no-referrer";
      const status = Number.isInteger(reply.status) && reply.status >= 200 && reply.status <= 599 ? reply.status : 502;
      const payload = reply.body_b64 ? Buffer.from(reply.body_b64, "base64") : Buffer.alloc(0);
      res.writeHead(status, outHeaders);
      res.end(payload);
    } catch (error) {
      const code = error.code;
      if (code === "timeout") return page(res, 504, "A máquina não respondeu", "A ASIC demorou mais de 30 segundos para responder.");
      if (code === "unreachable") return page(res, 502, "Máquina inacessível", "O coletor não conseguiu abrir a tela da ASIC na rede da fazenda. Confira se a máquina está ligada e na rede.");
      if (code === "too_large") return page(res, 502, "Resposta muito grande", "A resposta da máquina passa de 10 MB, o limite do acesso remoto.");
      if (code === "agent_offline" || code === "agent_replaced") return page(res, 502, "Coletor desconectou", "A conexão com o coletor caiu durante a requisição. Tente de novo.");
      log.error("relay: erro ao encaminhar", minerId, error.message);
      return page(res, 502, "Falha no acesso remoto", "Não foi possível falar com a máquina.");
    } finally {
      const current = entry.inflight.get(minerId) ?? 1;
      if (current <= 1) entry.inflight.delete(minerId); else entry.inflight.set(minerId, current - 1);
    }
  }

  function rewriteLocation(location, info, publicOrigin) {
    const port = info.webPort && info.webPort !== 80 ? `:${info.webPort}` : "";
    for (const prefix of [`http://${info.ip}${port}`, `http://${info.ip}`]) {
      if (location === prefix || location.startsWith(`${prefix}/`) || location.startsWith(`${prefix}?`)) return `${publicOrigin}${location.slice(prefix.length) || "/"}`;
    }
    return location;
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log.error("relay: erro inesperado", error);
      if (!res.headersSent) page(res, 500, "Erro interno", "Tente novamente."); else res.end();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://relay.local");
    if (url.pathname !== "/agent") { socket.write("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const authorization = String(req.headers.authorization ?? "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    authenticateAgent(token).then((identity) => {
      if (!identity) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => onAgentConnection(ws, identity));
    }).catch(() => { socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); socket.destroy(); });
  });

  return {
    server,
    agents,
    close: () => new Promise((resolve) => { clearInterval(heartbeat); for (const entry of agents.values()) entry.ws.terminate(); wss.close(); server.close(() => resolve()); }),
  };
}
