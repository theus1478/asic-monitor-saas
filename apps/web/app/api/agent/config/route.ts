import { hashAgentToken } from "../../../../lib/agent-token";
import { createServiceClient } from "../../../../lib/supabase/service";

export const runtime = "nodejs";

const MINER_TYPES = new Set(["antminer", "whatsminer", "avalon"]);

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) return null;
  const service = createServiceClient();
  const { data: agent } = await service.from("agents").select("id, farm_id").eq("token_hash", hashAgentToken(token)).maybeSingle();
  return agent ? { service, agent } : null;
}

export async function GET(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido." }, { status: 401 });

  const { data: miners } = await auth.service
    .from("miners")
    .select("id, name, ip, protocol_port, type")
    .eq("farm_id", auth.agent.farm_id)
    .eq("enabled", true);

  return Response.json({
    miners: (miners ?? []).map((m) => ({ id: m.id, name: m.name, ip: m.ip, port: m.protocol_port, type: m.type })),
    poll_interval_seconds: 30,
  });
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

/** O app local registra (upsert por IP) as máquinas que encontrou por scan ou cadastro manual. */
export async function POST(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido." }, { status: 401 });

  const body = await request.json().catch(() => null) as { miners?: MinerInput[] } | null;
  const inputs = (Array.isArray(body?.miners) ? body.miners : []).slice(0, 200).map(cleanMiner).filter((m): m is NonNullable<typeof m> => m !== null);
  if (!inputs.length) return Response.json({ error: "Nenhuma máquina válida enviada." }, { status: 400 });

  const { data: existing } = await auth.service.from("miners").select("id, ip").eq("farm_id", auth.agent.farm_id);
  const byIp = new Map((existing ?? []).map((m) => [m.ip, m.id]));

  const toInsert = inputs.filter((m) => !byIp.has(m.ip)).map((m) => ({ farm_id: auth.agent.farm_id, name: m.name, ip: m.ip, protocol_port: m.port, type: m.type }));
  const toUpdate = inputs.filter((m) => byIp.has(m.ip));

  if (toInsert.length) {
    const { error } = await auth.service.from("miners").insert(toInsert);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  for (const miner of toUpdate) {
    await auth.service.from("miners").update({ name: miner.name, protocol_port: miner.port, type: miner.type }).eq("id", byIp.get(miner.ip));
  }

  const { data: miners } = await auth.service.from("miners").select("id, name, ip, protocol_port, type").eq("farm_id", auth.agent.farm_id).eq("enabled", true);
  return Response.json({ miners: (miners ?? []).map((m) => ({ id: m.id, name: m.name, ip: m.ip, port: m.protocol_port, type: m.type })) });
}

/** Remove uma máquina cadastrada pelo app local, identificada pelo IP. */
export async function DELETE(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido." }, { status: 401 });

  const body = await request.json().catch(() => null) as { ip?: unknown } | null;
  const ip = typeof body?.ip === "string" ? body.ip.trim() : "";
  if (!ip) return Response.json({ error: "IP não informado." }, { status: 400 });

  const { error } = await auth.service.from("miners").delete().eq("farm_id", auth.agent.farm_id).eq("ip", ip);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
