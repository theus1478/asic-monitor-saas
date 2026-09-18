// Teste ponta a ponta: Supabase falso + ASIC falsa + coletor falso + relay real.
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createRelay } from "../src/relay.js";
import { sign } from "../src/token.js";

const SECRET = "segredo-de-teste-com-32-bytes-ou-mais";
const PEPPER = "pepper";
const BASE = "remote.test";
const AGENT_TOKEN = "token-do-agente";
const AGENT_HASH = createHash("sha256").update(`${AGENT_TOKEN}${PEPPER}`).digest("hex");
const ORG = randomUUID();
const FARM = randomUUID();
const MINER = randomUUID();
const OFF_MINER = randomUUID();
const ASIC_IP = "127.0.0.1";

let farmRemoteEnabled = true;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// ---- Supabase falso ----
const supabase = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/rest/v1/agents") {
    const hash = url.searchParams.get("token_hash")?.replace("eq.", "");
    return res.end(JSON.stringify(hash === AGENT_HASH ? [{ id: "a1", farm_id: FARM }] : []));
  }
  if (url.pathname === "/rest/v1/miners") {
    const id = url.searchParams.get("id")?.replace("eq.", "");
    if (id === MINER || id === OFF_MINER) return res.end(JSON.stringify([{ id, enabled: true, ip: ASIC_IP, web_port: 80, farm: { id: FARM, organization_id: ORG, remote_access_enabled: farmRemoteEnabled } }]));
    return res.end("[]");
  }
  res.statusCode = 404; res.end("{}");
});

// ---- ASIC falsa ----
const seen = [];
const asic = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();
  seen.push({ method: req.method, url: req.url, headers: req.headers, body });
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=abc; Path=/; Domain=192.168.1.5" }); return res.end("<h1>ASIC login</h1>"); }
  if (req.url === "/cgi-bin/echo") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(`${req.method}:${body}`); }
  if (req.url === "/redirect") { res.writeHead(302, { location: `http://${ASIC_IP}/cgi-bin/next` }); return res.end(); }
  if (req.url === "/slow") return; // nunca responde
  if (req.url === "/big") { res.writeHead(200); return res.end(Buffer.alloc(200_000, 7)); }
  res.writeHead(404); res.end("nope");
});

const supabasePort = await listen(supabase);
const asicPort = await listen(asic);

const relay = createRelay({ supabaseUrl: `http://127.0.0.1:${supabasePort}`, serviceKey: "svc", pepper: PEPPER, secret: SECRET, baseDomain: BASE, requestTimeoutMs: 800, log: { info() {}, error() {} } });
const relayPort = await listen(relay.server);

// ---- Coletor falso: mesmo protocolo que apps/agent/src/tunnel.py ----
function connectAgent(token = AGENT_TOKEN) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/agent`, { headers: { authorization: `Bearer ${token}` } });
    ws.on("unexpected-response", (_req, res) => reject(Object.assign(new Error("rejected"), { status: res.statusCode })));
    ws.on("error", reject);
    ws.on("open", () => resolve(ws));
    ws.on("message", async (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.t !== "req") return;
      if (frame.miner_id === OFF_MINER) return ws.send(JSON.stringify({ t: "err", id: frame.id, code: "unreachable", message: "sem rota" }));
      const body = frame.body_b64 ? Buffer.from(frame.body_b64, "base64") : undefined;
      const upstream = http.request({ host: ASIC_IP, port: asicPort, path: frame.path, method: frame.method, headers: frame.headers }, async (r) => {
        const chunks = []; for await (const c of r) chunks.push(c);
        const headers = []; for (const [k, v] of Object.entries(r.headers)) for (const item of [].concat(v)) headers.push([k, item]);
        ws.send(JSON.stringify({ t: "res", id: frame.id, status: r.statusCode, headers, body_b64: Buffer.concat(chunks).toString("base64") }));
      });
      upstream.on("error", () => ws.send(JSON.stringify({ t: "err", id: frame.id, code: "unreachable", message: "x" })));
      upstream.end(body);
    });
  });
}

// ---- cliente do "navegador" (permite escolher o Host) ----
function browse(host, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: relayPort, path, method, headers: { host, ...headers } }, async (res) => {
      const chunks = []; for await (const c of res) chunks.push(c);
      resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() });
    });
    req.on("error", reject);
    req.end(body);
  });
}

const now = () => Math.floor(Date.now() / 1000);
const link = (over = {}) => sign({ k: "t", m: MINER, o: ORG, u: "user1", exp: now() + 300, n: randomUUID(), ...over }, SECRET);
const HOST = `m-${MINER}.${BASE}`;
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

async function login() {
  const response = await browse(HOST, `/?t=${link()}`);
  assert.equal(response.status, 302);
  const cookie = response.headers["set-cookie"][0].split(";")[0];
  return { cookie, response };
}

let agent;
try {
  await test("saúde e host desconhecido", async () => {
    assert.equal((await browse("qualquer.coisa", "/__health")).body, "ok");
    assert.equal((await browse("example.com", "/")).status, 404);
    assert.equal((await browse(`m-${randomUUID()}.${BASE}`, "/")).status, 404);
  });

  await test("coletor com token errado é recusado", async () => {
    await assert.rejects(connectAgent("token-errado"), (e) => e.status === 401);
  });

  await test("sem link nem cookie → 401", async () => {
    assert.equal((await browse(HOST, "/")).status, 401);
    assert.equal((await browse(HOST, "/", { headers: { cookie: "__ra=lixo" } })).status, 401);
  });

  await test("link de outra organização/máquina/expirado → 401", async () => {
    assert.equal((await browse(HOST, `/?t=${link({ o: randomUUID() })}`)).status, 401);
    assert.equal((await browse(HOST, `/?t=${link({ m: randomUUID() })}`)).status, 401);
    assert.equal((await browse(HOST, `/?t=${link({ exp: now() - 5 })}`)).status, 401);
    assert.equal((await browse(HOST, `/?t=${link().slice(0, -3)}xyz`)).status, 401);
  });

  await test("link válido vira cookie e é de uso único", async () => {
    const token = link();
    const first = await browse(HOST, `/?t=${token}`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, "/");
    assert.match(first.headers["set-cookie"][0], /^__ra=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/);
    const second = await browse(HOST, `/?t=${token}`);
    assert.equal(second.status, 401);
  });

  await test("com cookie mas coletor offline → 502", async () => {
    const { cookie } = await login();
    assert.equal((await browse(HOST, "/", { headers: { cookie } })).status, 502);
  });

  if (process.env.E2E_PY_AGENT) {
    // Usa o coletor de verdade (Python) no lugar do simulador em Node.
    const child = spawn(process.env.E2E_PY_AGENT, [fileURLToPath(new URL("./py_agent.py", import.meta.url)),`ws://127.0.0.1:${relayPort}/agent`, AGENT_TOKEN, ASIC_IP, String(asicPort), MINER, "1", OFF_MINER], { stdio: ["ignore", "inherit", "inherit"] });
    for (let i = 0; i < 100 && !relay.agents.has(FARM); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(relay.agents.has(FARM), "coletor Python não conectou");
    agent = { close: () => child.kill(), terminate: () => child.kill() };
  } else {
    agent = await connectAgent();
  }

  await test("GET pelo túnel devolve a tela da ASIC, sem repassar o cookie do painel, e limpa Domain do Set-Cookie", async () => {
    const { cookie } = await login();
    seen.length = 0;
    const response = await browse(HOST, "/", { headers: { cookie: `${cookie}; sid=x` } });
    assert.equal(response.status, 200);
    assert.equal(response.body, "<h1>ASIC login</h1>");
    assert.ok(!/domain=/i.test(response.headers["set-cookie"][0]));
    assert.equal(seen[0].headers.cookie, "sid=x");
    assert.ok([undefined, "identity"].includes(seen[0].headers["accept-encoding"]));
  });

  await test("POST com corpo faz ida e volta", async () => {
    const { cookie } = await login();
    const response = await browse(HOST, "/cgi-bin/echo", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: '{"a":1}' });
    assert.equal(response.body, 'POST:{"a":1}');
  });

  await test("Location é reescrito para o subdomínio público", async () => {
    const { cookie } = await login();
    const response = await browse(HOST, "/redirect", { headers: { cookie } });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `https://${HOST}/cgi-bin/next`);
  });

  await test("resposta grande passa inteira", async () => {
    const { cookie } = await login();
    const response = await browse(HOST, "/big", { headers: { cookie } });
    assert.equal(response.body.length, 200_000);
  });

  await test("timeout → 504 e a conexão continua utilizável", async () => {
    const { cookie } = await login();
    assert.equal((await browse(HOST, "/slow", { headers: { cookie } })).status, 504);
    assert.equal((await browse(HOST, "/", { headers: { cookie } })).status, 200);
  });

  await test("erro 'unreachable' do coletor → 502", async () => {
    const host = `m-${OFF_MINER}.${BASE}`;
    const response = await browse(host, `/?t=${link({ m: OFF_MINER })}`);
    const cookie = response.headers["set-cookie"][0].split(";")[0];
    const status = (await browse(host, "/", { headers: { cookie } })).status;
    // No Windows, conexão recusada em localhost demora ~2 s e o timeout de teste (0,8 s) pode vencer antes.
    assert.ok(process.env.E2E_PY_AGENT ? [502, 504].includes(status) : status === 502, `status ${status}`);
  });

  await test("WebSocket do navegador → 501", async () => {
    const { cookie } = await login();
    const response = await browse(HOST, "/ws", { headers: { cookie, upgrade: "websocket", connection: "Upgrade" } });
    assert.equal(response.status, 501);
  });

  await test("corpo acima de 10 MB → 413", async () => {
    const { cookie } = await login();
    const response = await browse(HOST, "/cgi-bin/echo", { method: "POST", headers: { cookie }, body: Buffer.alloc(10 * 1024 * 1024 + 1, 1) }).catch((e) => ({ status: e.code }));
    assert.ok(response.status === 413 || response.status === "ECONNRESET" || response.status === "EPIPE");
  });

  await test("acesso remoto desligado na fazenda → 403 (após expirar o cache)", async () => {
    const { cookie } = await login();
    farmRemoteEnabled = false;
    // o cache da máquina dura 60 s; força a expiração pelo relógio
    const realNow = Date.now; Date.now = () => realNow() + 61_000;
    try { assert.equal((await browse(HOST, "/", { headers: { cookie } })).status, 403); } finally { Date.now = realNow; }
    farmRemoteEnabled = true;
  });

  await test("coletor desconecta → requisições pendentes falham e volta a dar 502", async () => {
    const realNow = Date.now; Date.now = () => realNow() + 122_000; // expira o cache com remote habilitado de novo
    try {
      const { cookie } = await login();
      const pending = browse(HOST, "/slow", { headers: { cookie } });
      await new Promise((r) => setTimeout(r, 100));
      agent.close();
      assert.equal((await pending).status, 502);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await browse(HOST, "/", { headers: { cookie } })).status, 502);
    } finally { Date.now = realNow; }
  });

  console.log(`\n${passed} testes passaram`);
} finally {
  try { agent?.terminate(); } catch { /* já fechado */ }
  await relay.close();
  supabase.close(); asic.close();
  supabase.closeAllConnections?.(); asic.closeAllConnections?.();
}
