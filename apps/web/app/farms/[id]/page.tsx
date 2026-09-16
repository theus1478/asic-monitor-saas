import { notFound } from "next/navigation";
import { getLicensedMachineCount, markLicensed } from "../../../lib/license";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";
import { currentTimeMs } from "../../../lib/time";
import { sweepOfflineIncidents } from "../../../lib/asic-alerts/offline-sweep";
import { addMiner } from "../actions";
import { CreateAgentPanel } from "../create-agent-panel";
import { LegacyMonitor, type EventRow, type IncidentSummary, type MonitorMiner } from "./legacy-monitor";
import { deleteMiner, rebootMiner, stopMiningOnMiner, updateMinerDevfee } from "./miner-actions";
import type { PoolCommandSummary } from "./pool-control";

type Miner = { id: string; name: string; ip: string; protocol_port: number; type: string; enabled: boolean; created_at: string; devfee_pct: number | null };
type Metric = { miner_id: string; online: boolean; hashrate_ths: number | null; temperature_c: number | null; power_w: number | null; observed_at: string; payload: Record<string, unknown> | null };
const FRESH_METRIC_MS = 90_000;

export default async function FarmDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ miner?: string }> }) {
  const { id } = await params;
  const { miner: initialMinerId } = await searchParams;
  const supabase = await createClient();
  const { data: farm } = await supabase.from("farms").select("id, name, timezone, organization_id").eq("id", id).maybeSingle();
  if (!farm) notFound();

  // Varredura preguiçosa de offline - quem entra direto na fazenda (sem passar
  // pela Visão Geral primeiro) também precisa disparar a checagem.
  try { await sweepOfflineIncidents(createServiceClient(), farm.organization_id); } catch (error) { console.error("Falha na varredura de offline", error); }

  const [{ data: miners }, { data: agents }, { data: poolCommands }, { data: orgFarms }, licensedCount] = await Promise.all([
    supabase.from("miners").select("id, name, ip, protocol_port, type, enabled, created_at, devfee_pct").eq("farm_id", id).order("created_at"),
    supabase.from("agents").select("id, name, status, last_seen_at").eq("farm_id", id).order("id"),
    supabase.from("pool_commands").select("id, kind, pool_url, target_count, status, created_at, result").eq("farm_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("farms").select("id").eq("organization_id", farm.organization_id),
    getLicensedMachineCount(supabase, farm.organization_id),
  ]);
  const minerList = (miners ?? []) as Miner[];
  const orgFarmIds = (orgFarms ?? []).map((f) => f.id);
  const { data: orgMiners } = orgFarmIds.length
    ? await supabase.from("miners").select("id, created_at").in("farm_id", orgFarmIds).eq("enabled", true)
    : { data: [] as { id: string; created_at: string }[] };
  const licensedById = markLicensed(orgMiners ?? [], licensedCount);
  const ids = minerList.map((miner) => miner.id);
  const [{ data }, { data: incidentData }, { data: eventData }] = await Promise.all([
    ids.length ? supabase.from("miner_metrics").select("miner_id, online, hashrate_ths, temperature_c, power_w, observed_at, payload").in("miner_id", ids).order("observed_at", { ascending: false }).limit(Math.max(720, ids.length * 120)) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("asic_incidents").select("miner_id, rule_key, severity, title").in("miner_id", ids).in("status", ["active", "acknowledged"]) : Promise.resolve({ data: [] as { miner_id: string; rule_key: string; severity: string; title: string }[] }),
    ids.length ? supabase.from("asic_events").select("id, miner_id, observed_at, level, category, message").in("miner_id", ids).order("observed_at", { ascending: false }).limit(Math.max(300, ids.length * 40)) : Promise.resolve({ data: [] as EventRow[] }),
  ]);
  const metrics = (data ?? []) as Metric[];
  const latest = new Map<string, Metric>();
  metrics.forEach((metric) => { if (!latest.has(metric.miner_id)) latest.set(metric.miner_id, metric); });
  const now = currentTimeMs();
  const incidentsByMiner = new Map<string, IncidentSummary[]>();
  for (const row of incidentData ?? []) {
    if (!incidentsByMiner.has(row.miner_id)) incidentsByMiner.set(row.miner_id, []);
    incidentsByMiner.get(row.miner_id)!.push({ ruleKey: row.rule_key, severity: row.severity as IncidentSummary["severity"], title: row.title });
  }
  const events = (eventData ?? []) as EventRow[];
  const monitorMiners = minerList.map((miner) => {
    const licensed = licensedById.get(miner.id) ?? false;
    const metric = licensed ? latest.get(miner.id) : undefined;
    const fresh = Boolean(metric && now - new Date(metric.observed_at).getTime() <= FRESH_METRIC_MS);
    const incidents = licensed ? incidentsByMiner.get(miner.id) ?? [] : [];
    const health: MonitorMiner["health"] = !fresh || !metric?.online ? "offline" : incidents.some((i) => i.severity === "critical") ? "critical" : incidents.some((i) => i.severity === "warning") ? "warning" : "ok";
    return { ...(licensed ? metric?.payload ?? {} : {}), id: miner.id, name: miner.name, ip: miner.ip, port: miner.protocol_port, type: miner.type, devfee_pct: miner.devfee_pct != null ? Number(miner.devfee_pct) : null, licensed, online: Boolean(metric?.online && fresh), observed_at: metric?.observed_at ?? null, hashrate_ths: licensed ? metric?.hashrate_ths ?? null : null, temp_c: licensed ? metric?.temperature_c ?? null : null, power_w: licensed ? metric?.power_w ?? null : null, health, incidents } as MonitorMiner;
  });
  const buckets = new Map<string, { hashrate: number; power: number }>();
  [...metrics].reverse().filter((metric) => licensedById.get(metric.miner_id)).forEach((metric) => {
    const date = new Date(metric.observed_at); date.setSeconds(0, 0); const key = date.toISOString();
    const value = buckets.get(key) ?? { hashrate: 0, power: 0 };
    if (metric.online) { value.hashrate += metric.hashrate_ths ?? 0; value.power += metric.power_w ?? 0; }
    buckets.set(key, value);
  });
  const history = [...buckets].map(([observedAt, values]) => ({ observedAt, ...values })).slice(-144);
  const agentList = (agents ?? []).map((agent) => ({ ...agent, is_online: Boolean(agent.last_seen_at && now - new Date(agent.last_seen_at).getTime() <= FRESH_METRIC_MS) }));
  return <LegacyMonitor farmId={farm.id} farmName={farm.name} timezone={farm.timezone} miners={monitorMiners} history={history} events={events} initialMinerId={initialMinerId ?? null} poolCommands={(poolCommands ?? []) as PoolCommandSummary[]} addMinerAction={addMiner.bind(null, id)} deleteMinerAction={deleteMiner.bind(null, id)} rebootMinerAction={rebootMiner.bind(null, id)} stopMiningAction={stopMiningOnMiner.bind(null, id)} updateDevfeeAction={updateMinerDevfee.bind(null, id)} agentPanel={<CreateAgentPanel farmId={farm.id} agents={agentList} />} />;
}
