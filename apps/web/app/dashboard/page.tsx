import Link from "next/link";
import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { monthlyPriceCents } from "../../lib/pricing";
import { currentTimeMs } from "../../lib/time";
import { LiveRefresh } from "../farms/live-refresh";

type Miner = { id: string; farm_id: string; name: string };
type Metric = { miner_id: string; online: boolean; hashrate_ths: number | null; observed_at: string };
const FRESH_METRIC_MS = 90_000;

function formatHashrate(ths: number) {
  if (ths >= 1000) return `${(ths / 1000).toFixed(2)} PH/s`;
  return `${ths.toFixed(2)} TH/s`;
}

export default async function DashboardPage() {
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
        .select("miner_id, online, hashrate_ths, observed_at")
        .in("miner_id", minerIds)
        .order("observed_at", { ascending: false })
        .limit(500)
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
  const estimatedMonthlyUsd = monthlyPriceCents(activeMachines) / 100;

  const farmCards = farmList.map((farm) => {
    const farmMiners = minerList.filter((m) => m.farm_id === farm.id);
    const online = farmMiners.filter((m) => isMinerOnline(m.id)).length;
    const hashrateThs = farmMiners.reduce((sum, m) => sum + (isMinerOnline(m.id) ? latestByMiner.get(m.id)?.hashrate_ths ?? 0 : 0), 0);
    return { ...farm, online, total: farmMiners.length, hashrateThs };
  });

  const attention = minerList
    .filter((m) => !isMinerOnline(m.id))
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
    const values = series.map(([, v]) => v);
    const max = Math.max(...values, 0.001);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = 600 / (series.length - 1);
    return values
      .map((v, i) => `${Math.round(i * stepX)},${Math.round(178 - ((v - min) / range) * 168)}`)
      .join(" ");
  })();

  return <Shell><PageHeader title="Visão geral" description="Dados recebidos dos agentes conectados." action={<LiveRefresh />} />
    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">MÁQUINAS ONLINE</p><div className="metric">{onlineMachines}<span>/{activeMachines}</span></div><p className="positive">● {availabilityPct}% disponíveis</p></article>
      <article className="card"><p className="eyebrow">HASH RATE TOTAL</p><div className="metric">{formatHashrate(totalHashrateThs)}</div><p className="muted">{farmList.length} fazenda{farmList.length === 1 ? "" : "s"}</p></article>
      <article className="card"><p className="eyebrow">MÁQUINAS CADASTRADAS</p><div className="metric">{activeMachines}</div><p className="muted">contam para a licença</p></article>
      <article className="card"><p className="eyebrow">ESTIMATIVA MENSAL</p><div className="metric">USDT {estimatedMonthlyUsd.toFixed(2)}</div><p className="warning-text"><Link href="/billing" className="text-link">ver fatura</Link></p></article>
    </section>
    <section className="content-grid">
      <article className="card chart">
        <div className="section-title"><div><h2>Hash rate recente</h2><p>Soma das máquinas a cada ciclo do coletor</p></div><b>{formatHashrate(totalHashrateThs)}</b></div>
        {chartPoints
          ? <div className="chart-lines"><i /><i /><i /><i /><svg viewBox="0 0 600 180" preserveAspectRatio="none"><polyline points={chartPoints} /></svg></div>
          : <p className="muted">Ainda não há histórico suficiente. Assim que o coletor enviar algumas leituras, o gráfico aparece aqui.</p>}
      </article>
      <article className="card alerts">
        <h2>Precisam de atenção</h2>
        {attention.length === 0
          ? <p className="muted">Nenhuma máquina offline no momento.</p>
          : attention.map((m) => <div className="alert-row" key={m.id}><span className="status-dot off" />{m.name} <small>Sem resposta na última leitura</small></div>)}
        <Link href="/farms" className="text-link">Ver todas as máquinas</Link>
      </article>
    </section>
    <section>
      <div className="section-title"><div><h2>Fazendas</h2><p>Estado dos seus agentes locais</p></div><Link href="/farms" className="text-link">Gerenciar</Link></div>
      {farmCards.length === 0
        ? <p className="muted">Nenhuma fazenda cadastrada ainda.</p>
        : <div className="farm-cards">{farmCards.map((farm) => <article className="card" key={farm.id}><span className={`status-dot ${farm.online > 0 ? "" : "off"}`} /> <b>{farm.name}</b><p className="muted">{farm.timezone}</p><div className="farm-values"><b>{farm.online}/{farm.total}</b><small>online</small><b>{formatHashrate(farm.hashrateThs)}</b><small>hash rate</small></div></article>)}</div>}
    </section>
  </Shell>;
}
