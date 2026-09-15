import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { currentTimeMs } from "../../lib/time";
import { LiveRefresh } from "../farms/live-refresh";

type Miner = { id: string; farm_id: string; name: string };
type Metric = { miner_id: string; online: boolean; hashrate_ths: number | null; power_w: number | null; observed_at: string };
const FRESH_METRIC_MS = 90_000;

function formatHashrate(ths: number) {
  if (ths >= 1000) return `${(ths / 1000).toFixed(2)} PH/s`;
  return `${ths.toFixed(2)} TH/s`;
}

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const { supabase, organizationId } = await getOrganizationId();

  const { data: farms } = organizationId
    ? await supabase.from("farms").select("id, name, timezone").eq("organization_id", organizationId).order("created_at")
    : { data: [] as { id: string; name: string; timezone: string }[] };
  const farmList = farms ?? [];
  const farmIds = farmList.map((f) => f.id);

  const { data: miners } = farmIds.length
    ? await supabase.from("miners").select("id, farm_id, name").in("farm_id", farmIds)
    : { data: [] as Miner[] };
  const minerList = miners ?? [];
  const minerIds = minerList.map((m) => m.id);

  const { data: recentMetrics } = minerIds.length
    ? await supabase
        .from("miner_metrics")
        .select("miner_id, online, hashrate_ths, power_w, observed_at")
        .in("miner_id", minerIds)
        .gte("observed_at", new Date(currentTimeMs() - 30 * 86400_000).toISOString())
        .order("observed_at", { ascending: false })
        .limit(10000)
    : { data: [] as Metric[] };
  const metrics = recentMetrics ?? [];

  const latestByMiner = new Map<string, Metric>();
  for (const m of metrics) {
    if (!latestByMiner.has(m.miner_id)) latestByMiner.set(m.miner_id, m);
  }

  const now = currentTimeMs();
  const isMinerOnline = (minerId: string) => {
    const metric = latestByMiner.get(minerId);
    return Boolean(metric?.online && now - new Date(metric.observed_at).getTime() <= FRESH_METRIC_MS);
  };

  const activeMachines = minerList.length;
  const onlineMachines = minerList.filter((m) => isMinerOnline(m.id)).length;
  const availabilityPct = activeMachines > 0 ? Math.round((onlineMachines / activeMachines) * 1000) / 10 : 0;
  const totalHashrateThs = minerList.reduce((sum, m) => sum + (isMinerOnline(m.id) ? latestByMiner.get(m.id)?.hashrate_ths ?? 0 : 0), 0);
  const energyByMiner = new Map<string, Metric[]>();
  for (const metric of metrics) {
    if (metric.online && metric.power_w != null) energyByMiner.set(metric.miner_id, [...(energyByMiner.get(metric.miner_id) ?? []), metric]);
  }
  let recordedKwh = 0;
  for (const minerMetrics of energyByMiner.values()) {
    minerMetrics.sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
    for (let index = 1; index < minerMetrics.length; index += 1) {
      const previous = minerMetrics[index - 1], current = minerMetrics[index];
      const hours = Math.min(300_000, new Date(current.observed_at).getTime() - new Date(previous.observed_at).getTime()) / 3_600_000;
      recordedKwh += (((previous.power_w ?? 0) + (current.power_w ?? 0)) / 2 / 1000) * Math.max(0, hours);
    }
  }

  const farmCards = farmList.map((farm) => {
    const farmMiners = minerList.filter((m) => m.farm_id === farm.id);
    const online = farmMiners.filter((m) => isMinerOnline(m.id)).length;
    const hashrateThs = farmMiners.reduce((sum, m) => sum + (isMinerOnline(m.id) ? latestByMiner.get(m.id)?.hashrate_ths ?? 0 : 0), 0);
    return { ...farm, online, total: farmMiners.length, hashrateThs };
  });

  const attention = minerList
    .filter((m) => !isMinerOnline(m.id) || (latestByMiner.get(m.id)?.hashrate_ths ?? 0) < 10)
    .slice(0, 4);

  // Série real: agrupa leituras pelo mesmo observed_at (um lote = um ciclo do agente)
  // e soma o hashrate de todas as máquinas naquele instante.
  const byTimestamp = new Map<string, number>();
  for (const m of metrics) {
    if (typeof m.hashrate_ths === "number") {
      byTimestamp.set(m.observed_at, (byTimestamp.get(m.observed_at) ?? 0) + m.hashrate_ths);
    }
  }
  const series = [...byTimestamp.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .slice(-20);

  const chartPoints = (() => {
    if (series.length < 2) return null;
    const raw = series.map(([, v]) => v);
    // Média móvel: oscilações de um ciclo pra outro são normais (arredondamento
    // do firmware, latência de varredura) e não devem parecer quedas reais.
    const window = 3;
    const values = raw.length <= window ? raw : raw.map((_, i) => {
      const slice = raw.slice(Math.max(0, i - window + 1), i + 1);
      return slice.reduce((sum, v) => sum + v, 0) / slice.length;
    });
    const max = Math.max(...values, 0.001);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = 600 / (series.length - 1);
    return values
      .map((v, i) => `${Math.round(i * stepX)},${Math.round(178 - ((v - min) / range) * 168)}`)
      .join(" ");
  })();

  return <Shell><PageHeader title={t("title")} description={t("description")} action={<LiveRefresh />} />
    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">{t("machinesOnline")}</p><div className="metric">{onlineMachines}<span>/{activeMachines}</span></div><p className="positive">● {t("availabilityPct", { pct: availabilityPct })}</p></article>
      <article className="card"><p className="eyebrow">{t("totalHashrate")}</p><div className="metric">{formatHashrate(totalHashrateThs)}</div><p className="muted">{t("farmCount", { count: farmList.length })}</p></article>
      <article className="card"><p className="eyebrow">{t("registeredMachines")}</p><div className="metric">{activeMachines}</div><p className="muted">{t("countTowardLicense")}</p></article>
      <article className="card"><p className="eyebrow">{t("recordedConsumption")}</p><div className="metric">{recordedKwh.toFixed(2)}<span> kWh</span></div><p className="muted">{t("sumOfAllFarms")}</p></article>
    </section>
    <section className="content-grid">
      <article className="card chart">
        <div className="section-title"><div><h2>{t("recentHashrate")}</h2><p>{t("sumPerCycle")}</p></div><b>{formatHashrate(totalHashrateThs)}</b></div>
        {chartPoints
          ? <div className="chart-lines"><i /><i /><i /><i /><svg viewBox="0 0 600 180" preserveAspectRatio="none"><polyline points={chartPoints} /></svg></div>
          : <p className="muted">{t("notEnoughHistory")}</p>}
      </article>
      <article className="card alerts">
        <h2>{t("needsAttention")}</h2>
        {attention.length === 0
          ? <p className="muted">{t("allOnlineAndHealthy")}</p>
          : attention.map((m) => { const metric = latestByMiner.get(m.id); const lowHash = isMinerOnline(m.id) && (metric?.hashrate_ths ?? 0) < 10; return <div className="alert-row" key={m.id}><span className={`status-dot ${lowHash ? "warn" : "off"}`} />{m.name}<small>{lowHash ? t("lowHashrate", { value: (metric?.hashrate_ths ?? 0).toFixed(2) }) : t("offlineOrUnresponsive")}</small></div>; })}
        <Link href="/farms" className="text-link">{t("seeAllMachines")}</Link>
      </article>
    </section>
    <section>
      <div className="section-title"><div><h2>{t("farms")}</h2><p>{t("agentsState")}</p></div><Link href="/farms" className="text-link">{t("manage")}</Link></div>
      {farmCards.length === 0
        ? <p className="muted">{t("noFarmsYet")}</p>
        : <div className="farm-cards">{farmCards.map((farm) => <article className="card" key={farm.id}><span className={`status-dot ${farm.online > 0 ? "" : "off"}`} /> <b>{farm.name}</b><p className="muted">{farm.timezone}</p><div className="farm-values"><b>{farm.online}/{farm.total}</b><small>{t("online")}</small><b>{formatHashrate(farm.hashrateThs)}</b><small>{t("hashRate")}</small></div></article>)}</div>}
    </section>
  </Shell>;
}
