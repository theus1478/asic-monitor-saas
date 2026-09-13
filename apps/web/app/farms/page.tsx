import Link from "next/link";
import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { monthlyPriceCents } from "../../lib/pricing";
import { currentTimeMs } from "../../lib/time";
import { addFarm, deleteFarm } from "./actions";
import { FarmDeleteButton } from "./farm-delete-button";

type Metric = { miner_id: string; online: boolean; observed_at: string };
const FRESH_MS = 90_000;

export default async function FarmsPage() {
  const { supabase, organizationId } = await getOrganizationId();
  const { data: farms } = organizationId ? await supabase.from("farms").select("id, name, timezone").eq("organization_id", organizationId).order("created_at") : { data: [] };
  const farmList = farms ?? [], farmIds = farmList.map((farm) => farm.id);
  const [{ data: miners }, { data: agents }] = farmIds.length ? await Promise.all([
    supabase.from("miners").select("id, farm_id").in("farm_id", farmIds),
    supabase.from("agents").select("id, farm_id, last_seen_at").in("farm_id", farmIds),
  ]) : [{ data: [] }, { data: [] }];
  const minerList = miners ?? [], minerIds = minerList.map((miner) => miner.id);
  const { data: metricRows } = minerIds.length ? await supabase.from("miner_metrics").select("miner_id, online, observed_at").in("miner_id", minerIds).order("observed_at", { ascending: false }).limit(Math.max(500, minerIds.length * 4)) : { data: [] };
  const latest = new Map<string, Metric>();
  (metricRows ?? []).forEach((metric) => { if (!latest.has(metric.miner_id)) latest.set(metric.miner_id, metric as Metric); });
  const now = currentTimeMs();
  const connected = (minerId: string) => { const metric = latest.get(minerId); return Boolean(metric?.online && now - new Date(metric.observed_at).getTime() < FRESH_MS); };

  return <Shell><PageHeader title="Fazendas" description="Gerencie locais, coletores e máquinas da sua operação." />
    <Link href="/collector" className="collector-banner"><span className="collector-icon">⇣</span><div><p className="eyebrow">COLETOR PARA WINDOWS</p><h2>Instale o agente no computador principal da fazenda</h2><p>Download, token e instruções agora ficam em uma página dedicada.</p></div><b>Configurar coletor →</b></Link>
    <section className="farm-list clean-list">
      {farmList.length === 0 && <article className="card empty-state"><span>▦</span><h2>Nenhuma fazenda cadastrada</h2><p>Crie sua primeira fazenda para começar a adicionar ASICs.</p></article>}
      {farmList.map((farm) => {
        const farmMiners = minerList.filter((miner) => miner.farm_id === farm.id);
        const online = farmMiners.filter((miner) => connected(miner.id)).length;
        const farmAgents = (agents ?? []).filter((agent) => agent.farm_id === farm.id);
        const agentOnline = farmAgents.some((agent) => agent.last_seen_at && now - new Date(agent.last_seen_at).getTime() < FRESH_MS);
        const cost = monthlyPriceCents(farmMiners.length) / 100;
        return <article className="card farm clean-farm" key={farm.id}>
          <div className="farm-title"><span className={`status-dot ${agentOnline ? "" : "off"}`} /><div><h2>{farm.name}</h2><p>{farm.timezone}</p></div></div>
          <div className="farm-stat"><b>{online}<span>/{farmMiners.length}</span></b><small>máquinas conectadas</small></div>
          <div className="farm-stat"><b>USDT {cost.toFixed(2)}</b><small>custo mensal das máquinas</small></div>
          <div className="farm-actions"><Link className="button secondary" href={`/farms/${farm.id}`} prefetch>Monitorar</Link><FarmDeleteButton action={deleteFarm.bind(null, farm.id)} farmName={farm.name} /></div>
        </article>;
      })}
    </section>
    <section className="card setup clean-form-card"><p className="eyebrow">NOVA FAZENDA</p><h2>Adicionar fazenda</h2><p className="muted">Organize suas máquinas por local físico.</p><form action={addFarm} className="inline-form"><input name="name" placeholder="Nome da fazenda" required /><input name="timezone" placeholder="Fuso horário" defaultValue="America/Sao_Paulo" /><button className="button" type="submit">Criar fazenda</button></form></section>
  </Shell>;
}
