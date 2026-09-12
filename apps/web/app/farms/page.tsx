import { PageHeader, Shell } from "../components";
import { farms } from "../../lib/demo-data";

export default function FarmsPage() {
  return <Shell><PageHeader title="Fazendas e máquinas" description="O agente local coleta dados da sua rede e os envia de forma segura para a nuvem." action={<button className="button">Adicionar fazenda</button>} />
    <section className="farm-list">{farms.map((farm) => <article className="card farm" key={farm.name}><div><span className="status-dot" /><h2>{farm.name}</h2><p>{farm.city} · Agente {farm.agent}</p></div><div><b>{farm.online}/{farm.miners}</b><small> máquinas online</small></div><div><b>{farm.hashrate}</b><small> hash rate</small></div><button className="button secondary">Ver máquinas</button></article>)}</section>
    <section className="card setup"><p className="eyebrow">PRÓXIMO PASSO</p><h2>Instale o agente na fazenda</h2><p>O executável Windows roda sem interface, acessa somente a rede local autorizada e envia métricas por HTTPS. Cada instalação recebe uma chave exclusiva da sua conta.</p><button className="button secondary">Gerar instalador do agente</button></section>
  </Shell>;
}
