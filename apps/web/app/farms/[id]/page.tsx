import { notFound } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { currentTimeMs } from "../../../lib/time";
import { addMiner } from "../actions";
import { CreateAgentPanel } from "../create-agent-panel";
import { LegacyMonitor, type MonitorMiner } from "./legacy-monitor";

type Miner = { id: string; name: string; ip: string; protocol_port: number; type: string; enabled: boolean };
type Metric = { miner_id: string; online: boolean; hashrate_ths: number | null; temperature_c: number | null; power_w: number | null; observed_at: string; payload: Record<string, unknown> | null };
const FRESH_METRIC_MS = 90_000;

export default async function FarmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: farm } = await supabase.from("farms").select("id, name, timezone").eq("id", id).maybeSingle();
  if (!farm) notFound();
  const [{ data: miners }, { data: agents }] = await Promise.all([
    supabase.from("miners").select("id, name, ip, protocol_port, type, enabled").eq("farm_id", id).order("created_at"),
    supabase.from("agents").select("id, name, status, last_seen_at").eq("farm_id", id).order("id"),
  ]);
  const minerList = (miners ?? []) as Miner[];
  const ids = minerList.map((miner) => miner.id);
  const { data } = ids.length ? await supabase.from("miner_metrics").select("miner_id, online, hashrate_ths, temperature_c, power_w, observed_at, payload").in("miner_id", ids).order("observed_at", { ascending: false }).limit(Math.max(720, ids.length * 120)) : { data: [] };
  const metrics = (data ?? []) as Metric[];
  const latest = new Map<string, Metric>();
  metrics.forEach((metric) => { if (!latest.has(metric.miner_id)) latest.set(metric.miner_id, metric); });
  const now = currentTimeMs();
  const monitorMiners = minerList.map((miner) => {
    const metric = latest.get(miner.id);
    const fresh = Boolean(metric && now - new Date(metric.observed_at).getTime() <= FRESH_METRIC_MS);
    return { ...(metric?.payload ?? {}), id: miner.id, name: miner.name, ip: miner.ip, port: miner.protocol_port, type: miner.type, online: Boolean(metric?.online && fresh), observed_at: metric?.observed_at ?? null, hashrate_ths: metric?.hashrate_ths ?? null, temp_c: metric?.temperature_c ?? null, power_w: metric?.power_w ?? null } as MonitorMiner;
  });
  const buckets = new Map<string, { hashrate: number; power: number }>();
  [...metrics].reverse().forEach((metric) => {
    const date = new Date(metric.observed_at); date.setSeconds(0, 0); const key = date.toISOString();
    const value = buckets.get(key) ?? { hashrate: 0, power: 0 };
    if (metric.online) { value.hashrate += metric.hashrate_ths ?? 0; value.power += metric.power_w ?? 0; }
    buckets.set(key, value);
  });
  const history = [...buckets].map(([observedAt, values]) => ({ observedAt, ...values })).slice(-144);
  const agentList = (agents ?? []).map((agent) => ({ ...agent, is_online: Boolean(agent.last_seen_at && now - new Date(agent.last_seen_at).getTime() <= FRESH_METRIC_MS) }));
  return <LegacyMonitor farmName={farm.name} timezone={farm.timezone} miners={monitorMiners} history={history} addMinerAction={addMiner.bind(null, id)} agentPanel={<CreateAgentPanel farmId={farm.id} agents={agentList} />} />;
}
