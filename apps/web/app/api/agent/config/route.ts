import { hashAgentToken } from "../../../../lib/agent-token";
import { getLicensedMachineCount, markLicensed } from "../../../../lib/license";
import { createServiceClient } from "../../../../lib/supabase/service";

export const runtime = "nodejs";

const MINER_TYPES = new Set(["antminer", "whatsminer", "avalon"]);

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) return null;
  const service = createServiceClient();
  const { data: agent } = await service.from("agents").select("id, farm_id").eq("token_hash", hashAgentToken(token)).maybeSingle();
  if (!agent) return null;
  const { data: farm } = await service.from("farms").select("id, name, organization_id, remote_access_enabled").eq("id", agent.farm_id).maybeSingle();
  if (!farm) return null;
  return { service, agent, farm };
}

/** Monta a resposta com as máquinas da fazenda, marcando quais estão cobertas pela licença da organização. */
async function buildConfigResponse(service: ReturnType<typeof createServiceClient>, farm: { id: string; name: string; organization_id: string; remote_access_enabled?: boolean | null }) {
  const { data: orgFarms } = await service.from("farms").select("id").eq("organization_id", farm.organization_id);
  const orgFarmIds = (orgFarms ?? []).map((f) => f.id);
  const [{ data: orgMiners }, licensedCount] = await Promise.all([
    service.from("miners").select("id, farm_id, name, ip, protocol_port, web_port, type, created_at").eq("enabled", true).in("farm_id", orgFarmIds.length ? orgFarmIds : [farm.id]),
    getLicensedMachineCount(service, farm.organization_id),
  ]);
  const all = orgMiners ?? [];
  const licensedById = markLicensed(all, licensedCount);
  const farmMiners = all.filter((m) => m.farm_id === farm.id);

  return {
    miners: farmMiners.map((m) => ({ id: m.id, name: m.name, ip: m.ip, port: m.protocol_port, web_port: m.web_port ?? 80, type: m.type, licensed: licensedById.get(m.id) ?? false })),
    // Acesso remoto: só liga quando o cliente ativa a fazenda no painel; o coletor só abre o túnel se vier true.
    remote_access_enabled: Boolean(farm.remote_access_enabled),
    remote_relay_url: process.env.REMOTE_RELAY_URL || "wss://relay.monitorasic.club/agent",
    poll_interval_seconds: 30,
    farm_name: farm.name,
    licensed_machines: licensedCount,
    used_machines: all.length,
  };
}

export async function GET(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido." }, { status: 401 });
  return Response.json(await buildConfigResponse(auth.service, auth.farm));
}

type MinerInput = { name?: unknown; ip?: unknown; port?: unknown; type?: unknown };

function cleanMiner(raw: MinerInput) {
  const ip = typeof raw.ip === "string" ? raw.ip.trim().slice(0, 64) : "";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : ip;
  const port = Number(raw.port) || 4028;
  const typeRaw = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "antminer";
  const type = MINER_TYPES.has(typeRaw) ? typeRaw : "antminer";
  return ip ? { name, ip, port, type } : null;
}

/**
 * O app local registra (upsert por IP) as máquinas que encontrou por scan ou
 * cadastro manual. Sempre aceita, mesmo sem licença disponível — a máquina
 * cadastrada além da licença aparece marcada como "licensed: false" e o
 * painel web mostra o aviso, sem exibir telemetria, até o cliente comprar.
 */
export async function POST(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido." }, { status: 401 });

  const body = await request.json().catch(() => null) as { miners?: MinerInput[] } | null;
  const inputs = (Array.isArray(body?.miners) ? body.miners : []).slice(0, 200).map(cleanMiner).filter((m): m is NonNullable<typeof m> => m !== null);
  if (!inputs.length) return Response.json({ error: "Nenhuma máquina válida enviada." }, { status: 400 });

  const { data: existing } = await auth.service.from("miners").select("id, ip").eq("farm_id", auth.farm.id);
  const byIp = new Map((existing ?? []).map((m) => [m.ip, m.id]));

  const toInsert = inputs.filter((m) => !byIp.has(m.ip)).map((m) => ({ farm_id: auth.farm.id, name: m.name, ip: m.ip, protocol_port: m.port, type: m.type }));
  const toUpdate = inputs.filter((m) => byIp.has(m.ip));

  if (toInsert.length) {
    const { error } = await auth.service.from("miners").insert(toInsert);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  for (const miner of toUpdate) {
    await auth.service.from("miners").update({ name: miner.name, protocol_port: miner.port, type: miner.type }).eq("id", byIp.get(miner.ip));
  }

  return Response.json(await buildConfigResponse(auth.service, auth.farm));
}

/**
 * Remove uma ou mais máquinas cadastradas pelo app local, identificadas pelo
 * IP. Aceita "ip" (uma máquina, compatível com versões antigas do coletor)
 * ou "ips" (lista, usada pelo "Remover marcadas"/"Remover todas" do app).
 */
export async function DELETE(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido." }, { status: 401 });

  const body = await request.json().catch(() => null) as { ip?: unknown; ips?: unknown } | null;
  const ips = Array.isArray(body?.ips)
    ? body.ips.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : typeof body?.ip === "string" && body.ip.trim()
      ? [body.ip.trim()]
      : [];
  if (!ips.length) return Response.json({ error: "Nenhum IP informado." }, { status: 400 });

  const { error } = await auth.service.from("miners").delete().eq("farm_id", auth.farm.id).in("ip", ips);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await buildConfigResponse(auth.service, auth.farm));
}
