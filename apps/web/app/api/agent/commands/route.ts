import { hashAgentToken } from "../../../../lib/agent-token";
import { decryptPoolCommand } from "../../../../lib/pool-command-crypto";
import { createServiceClient } from "../../../../lib/supabase/service";

export const runtime = "nodejs";

type PoolCommandPayload = {
  minerIds: string[];
  pools: { url: string; worker: string; password: string }[];
  credentialsByMiner: Record<string, { username: string; password: string }>;
};
type RebootCommandPayload = { minerIds: string[]; credentialsByMiner?: Record<string, { username: string; password: string }> };

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
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido ou ausente." }, { status: 401 });
  const { service, agent } = auth;
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 3 * 60_000).toISOString();
  await service.from("pool_commands").update({ status: "expired", completed_at: now }).eq("agent_id", agent.id).in("status", ["pending", "processing"]).lt("expires_at", now);
  await service.from("pool_commands").update({ status: "pending", claimed_at: null }).eq("agent_id", agent.id).eq("status", "processing").lt("claimed_at", stale).gt("expires_at", now);

  const { data: command } = await service.from("pool_commands").select("id, kind, encrypted_payload").eq("agent_id", agent.id).eq("status", "pending").gt("expires_at", now).order("created_at").limit(1).maybeSingle();
  if (!command) return Response.json({ command: null });
  const { data: claimed } = await service.from("pool_commands").update({ status: "processing", claimed_at: now }).eq("id", command.id).eq("status", "pending").select("id, kind, encrypted_payload").maybeSingle();
  if (!claimed) return Response.json({ command: null });

  try {
    if (claimed.kind === "reboot") {
      const payload = decryptPoolCommand<RebootCommandPayload>(claimed.encrypted_payload);
      const { data: miners } = await service.from("miners").select("id, name, ip, protocol_port, type").eq("farm_id", agent.farm_id).in("id", payload.minerIds);
      return Response.json({ command: { id: claimed.id, kind: "reboot", miners: (miners ?? []).map((miner) => ({ ...miner, port: miner.protocol_port, credentials: payload.credentialsByMiner?.[miner.id] })) } });
    }
    const payload = decryptPoolCommand<PoolCommandPayload>(claimed.encrypted_payload);
    const { data: miners } = await service.from("miners").select("id, name, ip, protocol_port, type").eq("farm_id", agent.farm_id).in("id", payload.minerIds);
    return Response.json({ command: { id: claimed.id, kind: "pool_update", pools: payload.pools, miners: (miners ?? []).map((miner) => ({ ...miner, port: miner.protocol_port, credentials: payload.credentialsByMiner[miner.id] })) } });
  } catch (error) {
    await service.from("pool_commands").update({ status: "failed", completed_at: now, result: { error: error instanceof Error ? error.message : "Falha ao abrir comando." } }).eq("id", claimed.id);
    return Response.json({ command: null });
  }
}

export async function POST(request: Request) {
  let auth;
  try { auth = await authenticate(request); } catch { return Response.json({ error: "Supabase não configurado." }, { status: 503 }); }
  if (!auth) return Response.json({ error: "Token inválido ou ausente." }, { status: 401 });
  const body = await request.json().catch(() => null) as { command_id?: string; results?: unknown[] } | null;
  if (!body?.command_id || !Array.isArray(body.results)) return Response.json({ error: "Resultado inválido." }, { status: 400 });
  const sanitized = body.results.slice(0, 500).map((item) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { miner_id: String(value.miner_id ?? "").slice(0, 64), name: String(value.name ?? "").slice(0, 160), success: value.success === true, message: String(value.message ?? "").slice(0, 500) };
  });
  const successes = sanitized.filter((result) => result.success).length;
  const status = successes === sanitized.length && sanitized.length ? "succeeded" : successes ? "partial" : "failed";
  const { data } = await auth.service.from("pool_commands").update({ status, completed_at: new Date().toISOString(), result: { results: sanitized, successes, failures: sanitized.length - successes } }).eq("id", body.command_id).eq("agent_id", auth.agent.id).eq("status", "processing").select("id").maybeSingle();
  if (!data) return Response.json({ error: "Comando não encontrado." }, { status: 404 });
  return Response.json({ accepted: true, status });
}
