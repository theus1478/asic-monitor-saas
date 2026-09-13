import { notFound } from "next/navigation";
import { PageHeader, Shell } from "../../components";
import { createClient } from "../../../lib/supabase/server";
import { currentTimeMs } from "../../../lib/time";
import { addMiner } from "../actions";
import { CreateAgentPanel } from "../create-agent-panel";
import { LiveRefresh } from "../live-refresh";

type Miner = {
  id: string;
  name: string;
  ip: string;
  protocol_port: number;
  type: string;
  enabled: boolean;
};

type Metric = {
  miner_id: string;
  online: boolean;
  hashrate_ths: number | null;
  temperature_c: number | null;
  power_w: number | null;
  observed_at: string;
  payload: Record<string, unknown> | null;
};

const FRESH_METRIC_MS = 90_000;

function payloadNumber(metric: Metric | undefined, key: string) {
  const value = metric?.payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadText(metric: Metric | undefined, key: string) {
  const value = metric?.payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatHashrate(value: number | null | undefined) {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} PH/s` : `${value.toFixed(2)} TH/s`;
}

function formatNumber(value: number | null | undefined, suffix: string, digits = 1) {
  return value == null ? "—" : `${value.toFixed(digits)} ${suffix}`;
}

function formatAge(date: string | null | undefined, now: number) {
  if (!date) return "Nunca recebeu dados";
  const seconds = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `há ${seconds}s`;
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86400)} dia${seconds < 172800 ? "" : "s"}`;
}

function formatUptime(seconds: number | null) {
  if (seconds == null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}min`;
}

export default async function FarmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: farm } = await supabase.from("farms").select("id, name, timezone").eq("id", id).maybeSingle();
  if (!farm) notFound();

  const { data: miners } = await supabase
    .from("miners")
    .select("id, name, ip, protocol_port, type, enabled")
    .eq("farm_id", id)
    .order("created_at");

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, status, last_seen_at")
    .eq("farm_id", id)
    .order("id");

  const minerList = (miners ?? []) as Miner[];
  const minerIds = minerList.map((miner) => miner.id);
  const { data: recentMetrics } = minerIds.length
    ? await supabase
        .from("miner_metrics")
        .select("miner_id, online, hashrate_ths, temperature_c, power_w, observed_at, payload")
        .in("miner_id", minerIds)
        .order("observed_at", { ascending: false })
        .limit(Math.max(300, minerIds.length * 20))
    : { data: [] as Metric[] };

  const metrics = (recentMetrics ?? []) as Metric[];
  const latestByMiner = new Map<string, Metric>();
  for (const metric of metrics) {
    if (!latestByMiner.has(metric.miner_id)) latestByMiner.set(metric.miner_id, metric);
  }

  const now = currentTimeMs();
  const monitoredMiners = minerList.map((miner) => {
    const metric = latestByMiner.get(miner.id);
    const fresh = Boolean(metric && now - new Date(metric.observed_at).getTime() <= FRESH_METRIC_MS);
    return { miner, metric, online: Boolean(metric?.online && fresh), fresh };
  });
  const onlineCount = monitoredMiners.filter((item) => item.online).length;
  const totalHashrate = monitoredMiners.reduce((sum, item) => sum + (item.online ? item.metric?.hashrate_ths ?? 0 : 0), 0);
  const totalPower = monitoredMiners.reduce((sum, item) => sum + (item.online ? item.metric?.power_w ?? 0 : 0), 0);
  const temperatures = monitoredMiners
    .filter((item) => item.online && item.metric?.temperature_c != null)
    .map((item) => item.metric?.temperature_c as number);
  const maxTemperature = temperatures.length ? Math.max(...temperatures) : null;

  const totalsByTime = new Map<string, number>();
  for (const metric of [...metrics].reverse()) {
    if (metric.online && metric.hashrate_ths != null) {
      totalsByTime.set(metric.observed_at, (totalsByTime.get(metric.observed_at) ?? 0) + metric.hashrate_ths);
    }
  }
  const series = [...totalsByTime.values()].slice(-24);
  const chartPoints = series.length > 1
    ? series.map((value, index) => {
        const max = Math.max(...series, 0.001);
        const min = Math.min(...series, 0);
        const range = max - min || 1;
        return `${Math.round(index * (600 / (series.length - 1)))},${Math.round(178 - ((value - min) / range) * 168)}`;
      }).join(" ")
    : null;

  const agentList = (agents ?? []).map((agent) => ({
    ...agent,
    is_online: Boolean(agent.last_seen_at && now - new Date(agent.last_seen_at).getTime() <= FRESH_METRIC_MS),
  }));

  const addMinerForFarm = addMiner.bind(null, id);

  return <Shell>
    <PageHeader title={farm.name} description={`Monitoramento da fazenda · ${farm.timezone}`} action={<LiveRefresh />} />
    <section className="metrics-grid farm-summary">
      <article className="card"><p className="eyebrow">MÁQUINAS ONLINE</p><div className="metric">{onlineCount}<span>/{minerList.length}</span></div><p className={onlineCount === minerList.length && minerList.length ? "positive" : "warning-text"}>{minerList.length ? `${Math.round((onlineCount / minerList.length) * 100)}% disponíveis` : "Cadastre a primeira ASIC"}</p></article>
      <article className="card"><p className="eyebrow">HASH RATE ATUAL</p><div className="metric">{formatHashrate(totalHashrate)}</div><p className="muted">somente leituras recentes</p></article>
      <article className="card"><p className="eyebrow">CONSUMO ESTIMADO</p><div className="metric">{totalPower > 0 ? formatNumber(totalPower / 1000, "kW", 2) : "—"}</div><p className="muted">soma das máquinas online</p></article>
      <article className="card"><p className="eyebrow">MAIOR TEMPERATURA</p><div className="metric">{formatNumber(maxTemperature, "°C", 1)}</div><p className={maxTemperature != null && maxTemperature >= 80 ? "warning-text" : "muted"}>{maxTemperature == null ? "aguardando telemetria" : maxTemperature >= 80 ? "verifique a refrigeração" : "operação normal"}</p></article>
    </section>

    <section className="card farm-chart">
      <div className="section-title"><div><h2>Hash rate da fazenda</h2><p>Últimos ciclos recebidos do coletor</p></div><b>{formatHashrate(totalHashrate)}</b></div>
      {chartPoints
        ? <div className="chart-lines"><i /><i /><i /><i /><svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="Histórico recente do hash rate"><polyline points={chartPoints} /></svg></div>
        : <p className="muted">Aguardando pelo menos duas leituras do coletor para montar o gráfico.</p>}
    </section>

    <section className="monitoring-section">
      <div className="section-title"><div><h2>Monitoramento das máquinas</h2><p>Uma máquina fica offline quando não envia uma leitura recente.</p></div></div>
      {monitoredMiners.length === 0
        ? <article className="card"><p className="muted">Nenhuma máquina cadastrada ainda. Adicione os IPs abaixo.</p></article>
        : <div className="miner-monitor-grid">{monitoredMiners.map(({ miner, metric, online, fresh }) => {
            const error = payloadText(metric, "error");
            const averageHashrate = payloadNumber(metric, "hashrate_avg_ths");
            const efficiency = payloadNumber(metric, "efficiency_jth");
            const model = payloadText(metric, "model");
            const pool = payloadText(metric, "pool");
            const worker = payloadText(metric, "worker");
            const uptime = payloadNumber(metric, "uptime_s");
            const fans = Array.isArray(metric?.payload?.fans_rpm)
              ? metric.payload.fans_rpm.filter((fan): fan is number => typeof fan === "number")
              : [];
            const accepted = payloadNumber(metric, "accepted");
            const rejected = payloadNumber(metric, "rejected");
            return <article className={`card miner-monitor-card ${online ? "online" : "offline"}`} key={miner.id}>
              <header>
                <div><span className={`status-dot ${online ? "" : "off"}`} /><h3>{miner.name}</h3><span className={`badge ${online ? "success" : "neutral"}`}>{online ? "Online" : metric ? "Offline" : "Sem dados"}</span></div>
                <small>{miner.ip}:{miner.protocol_port} · {miner.type}</small>
              </header>
              <div className="miner-primary-metrics">
                <div><span>Hash rate</span><strong>{online ? formatHashrate(metric?.hashrate_ths) : "—"}</strong>{averageHashrate != null && <small>Média {formatHashrate(averageHashrate)}</small>}</div>
                <div><span>Temperatura</span><strong>{formatNumber(metric?.temperature_c, "°C")}</strong></div>
                <div><span>Potência</span><strong>{formatNumber(metric?.power_w, "W", 0)}</strong></div>
                <div><span>Eficiência</span><strong>{formatNumber(efficiency, "J/TH", 2)}</strong></div>
              </div>
              <dl className="miner-details">
                <div><dt>Modelo</dt><dd>{model ?? "—"}</dd></div>
                <div><dt>Uptime</dt><dd>{formatUptime(uptime)}</dd></div>
                <div><dt>Ventoinhas</dt><dd>{fans.length ? fans.map((fan) => `${fan} RPM`).join(" · ") : "—"}</dd></div>
                <div><dt>Shares</dt><dd>{accepted != null ? `${accepted} aceitas · ${rejected ?? 0} rejeitadas` : "—"}</dd></div>
                <div className="wide"><dt>Pool / worker</dt><dd>{pool ?? "—"}{worker ? ` · ${worker}` : ""}</dd></div>
                <div className="wide"><dt>Última leitura</dt><dd>{formatAge(metric?.observed_at, now)}{metric && !fresh ? " · telemetria expirada" : ""}</dd></div>
              </dl>
              {error && <p className="miner-error">{error}</p>}
            </article>;
          })}</div>}
    </section>

    <section className="card table-card">
      <h2>Adicionar máquina</h2>
      <form action={addMinerForFarm} className="inline-form">
        <input name="name" placeholder="Nome (ex: ASIC-01)" required />
        <input name="ip" placeholder="IP local (ex: 192.168.1.101)" required />
        <input name="port" placeholder="Porta" defaultValue={4028} />
        <select name="type" defaultValue="antminer">
          <option value="antminer">Antminer</option>
          <option value="whatsminer">Whatsminer</option>
          <option value="avalon">Avalon</option>
        </select>
        <button className="button secondary" type="submit">Adicionar máquina</button>
      </form>
      <small className="muted">O coletor busca essa lista automaticamente da nuvem — não precisa editar o config.json local.</small>
    </section>
    <CreateAgentPanel farmId={farm.id} agents={agentList} />
  </Shell>;
}
