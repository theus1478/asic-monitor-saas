import { hashAgentToken } from "../../../../lib/agent-token";
import { createServiceClient } from "../../../../lib/supabase/service";

export const runtime = "nodejs";

type MinerMetric = {
  name?: string;
  ip?: string;
  online?: boolean;
  hashrate_ths?: number | null;
  temp_c?: number | null;
  power_w?: number | null;
  error?: string | null;
  [key: string]: unknown;
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) {
    return Response.json({ error: "Token do agente ausente." }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 });
  }

  const tokenHash = hashAgentToken(token);
  const { data: agent } = await supabase
    .from("agents")
    .select("id, farm_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!agent) {
    return Response.json({ error: "Token inválido." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.metrics)) {
    return Response.json({ error: "Payload inválido: esperado { observed_at, metrics: [] }." }, { status: 400 });
  }

  const observedAt = typeof body.observed_at === "string" ? body.observed_at : new Date().toISOString();

  const { data: farmMiners } = await supabase
    .from("miners")
    .select("id, ip")
    .eq("farm_id", agent.farm_id);

  const minerIdByIp = new Map((farmMiners ?? []).map((m) => [m.ip, m.id]));

  const metrics = body.metrics as MinerMetric[];
  const rows = metrics
    .filter((metric) => metric && typeof metric.ip === "string" && minerIdByIp.has(metric.ip))
    .map((metric) => ({
      miner_id: minerIdByIp.get(metric.ip as string),
      observed_at: observedAt,
      online: Boolean(metric.online),
      hashrate_ths: typeof metric.hashrate_ths === "number" ? metric.hashrate_ths : null,
      temperature_c: typeof metric.temp_c === "number" ? metric.temp_c : null,
      power_w: typeof metric.power_w === "number" ? metric.power_w : null,
      payload: metric,
    }));

  if (rows.length > 0) {
    await supabase.from("miner_metrics").insert(rows);
  }

  await supabase
    .from("agents")
    .update({ status: "online", last_seen_at: new Date().toISOString() })
    .eq("id", agent.id);

  return Response.json({ accepted: rows.length, ignored: metrics.length - rows.length });
}
