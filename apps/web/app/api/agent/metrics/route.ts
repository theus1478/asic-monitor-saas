import { hashAgentToken } from "../../../../lib/agent-token";
import { createServiceClient } from "../../../../lib/supabase/service";
import { processTelemetryBatch } from "../../../../lib/asic-alerts/engine";

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
    .select("id, farm_id, farms(organization_id)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!agent) {
    return Response.json({ error: "Token inválido." }, { status: 401 });
  }
  const organizationId = (agent.farms as unknown as { organization_id: string } | null)?.organization_id ?? null;

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
    // Le o estado anterior de cada maquina ANTES de inserir a leitura nova -
    // o motor de regras precisa comparar "antes vs agora" (reboot, hashboard
    // que sumiu etc.), entao a ordem importa aqui.
    const rowMinerIds = [...new Set(rows.map((r) => r.miner_id))] as string[];
    const { data: previousRows } = await supabase
      .from("miner_metrics")
      .select("miner_id, online, hashrate_ths, temperature_c, payload")
      .in("miner_id", rowMinerIds)
      .order("observed_at", { ascending: false })
      .limit(rowMinerIds.length * 2);
    const previousByMiner = new Map<string, { online: boolean; hashrate_ths: number | null; temperature_c: number | null; payload: Record<string, unknown> } | null>();
    for (const row of previousRows ?? []) {
      if (!previousByMiner.has(row.miner_id)) previousByMiner.set(row.miner_id, row as { online: boolean; hashrate_ths: number | null; temperature_c: number | null; payload: Record<string, unknown> });
    }

    await supabase.from("miner_metrics").insert(rows);

    if (organizationId) {
      // Falha aqui nunca deve derrubar a resposta pro coletor - a telemetria
      // ja foi gravada, o motor de alertas roda "best effort" por cima dela.
      try {
        await processTelemetryBatch(supabase, {
          organizationId, farmId: agent.farm_id,
          previousByMiner,
          rows: rows.map((r) => ({ miner_id: r.miner_id as string, online: r.online, hashrate_ths: r.hashrate_ths, temperature_c: r.temperature_c, payload: r.payload as Record<string, unknown> })),
        });
      } catch (error) {
        console.error("Falha ao processar motor de alertas", error);
      }
    }
  }

  await supabase
    .from("agents")
    .update({ status: "online", last_seen_at: new Date().toISOString() })
    .eq("id", agent.id);

  return Response.json({ accepted: rows.length, ignored: metrics.length - rows.length });
}
