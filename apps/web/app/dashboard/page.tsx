import { PageHeader, Shell } from "../components";
import { farms, overview } from "../../lib/demo-data";

export default function DashboardPage() {
  return <Shell><PageHeader title="Visão geral" description="Atualizado agora · Dados demonstrativos até conectar seu agente." />
    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">MÁQUINAS ONLINE</p><div className="metric">{overview.onlineMachines}<span>/{overview.activeMachines}</span></div><p className="positive">● 88,9% disponíveis</p></article>
      <article className="card"><p className="eyebrow">HASH RATE TOTAL</p><div className="metric">{overview.totalHashrate}</div><p className="muted">nas duas fazendas</p></article>
      <article className="card"><p className="eyebrow">LICENÇAS</p><div className="metric">{overview.activeMachines}<span>/{overview.licensedMachines}</span></div><p className="muted">máquinas em uso</p></article>
      <article className="card"><p className="eyebrow">PRÓXIMA FATURA</p><div className="metric">US$ {overview.nextInvoice.amount}</div><p className="warning-text">{overview.nextInvoice.dueDate}</p></article>
    </section>
    <section className="content-grid"><article className="card chart"><div className="section-title"><div><h2>Hash rate nas últimas 24h</h2><p>Produção consolidada da operação</p></div><b>2.41 PH/s</b></div><div className="chart-lines"><i /><i /><i /><i /><svg viewBox="0 0 600 180" preserveAspectRatio="none"><polyline points="0,127 40,121 80,128 120,98 160,105 200,70 240,81 280,48 320,63 360,42 400,58 440,24 480,39 520,17 560,31 600,12" /></svg></div></article>
      <article className="card alerts"><h2>Precisam de atenção</h2><div className="alert-row"><span className="status-dot off" />ASIC-06 <small>Sem resposta há 3 min</small></div><div className="alert-row"><span className="status-dot warn" />ASIC-17 <small>Temperatura elevada</small></div><a href="/farms" className="text-link">Ver todas as máquinas</a></article></section>
    <section><div className="section-title"><div><h2>Fazendas</h2><p>Estado dos seus agentes locais</p></div><a href="/farms" className="text-link">Gerenciar</a></div><div className="farm-cards">{farms.map(farm => <article className="card" key={farm.name}><span className="status-dot" /> <b>{farm.name}</b><p className="muted">{farm.city}</p><div className="farm-values"><b>{farm.online}/{farm.miners}</b><small>online</small><b>{farm.hashrate}</b><small>hash rate</small></div></article>)}</div></section>
  </Shell>;
}
