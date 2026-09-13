import Link from "next/link";
import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { addFarm } from "./actions";

export default async function FarmsPage() {
  const { supabase, organizationId } = await getOrganizationId();

  const { data: farms } = organizationId
    ? await supabase.from("farms").select("id, name, timezone").eq("organization_id", organizationId).order("created_at")
    : { data: [] as { id: string; name: string; timezone: string }[] };

  const farmList = farms ?? [];
  const farmIds = farmList.map((f) => f.id);

  const { data: miners } = farmIds.length
    ? await supabase.from("miners").select("id, farm_id").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string }[] };

  const { data: agents } = farmIds.length
    ? await supabase.from("agents").select("id, farm_id, status").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string; status: string }[] };

  return <Shell><PageHeader title="Fazendas e máquinas" description="O agente local coleta dados da sua rede e os envia de forma segura para a nuvem." />
    <section className="farm-list">
      {farmList.length === 0 && <article className="card"><p className="muted">Nenhuma fazenda cadastrada ainda. Crie a primeira abaixo.</p></article>}
      {farmList.map((farm) => {
        const farmMiners = (miners ?? []).filter((m) => m.farm_id === farm.id);
        const farmAgents = (agents ?? []).filter((a) => a.farm_id === farm.id);
        const online = farmAgents.some((a) => a.status === "online");
        return <article className="card farm" key={farm.id}>
          <div><span className={`status-dot ${online ? "" : "off"}`} /><h2>{farm.name}</h2><p>{farm.timezone}</p></div>
          <div><b>{farmMiners.length}</b><small> máquina{farmMiners.length === 1 ? "" : "s"} cadastrada{farmMiners.length === 1 ? "" : "s"}</small></div>
          <div><b>{farmAgents.length}</b><small> agente{farmAgents.length === 1 ? "" : "s"} {online ? "online" : "sem contato"}</small></div>
          <Link className="button secondary" href={`/farms/${farm.id}`}>Ver máquinas</Link>
        </article>;
      })}
    </section>
    <section className="card setup">
      <p className="eyebrow">NOVA FAZENDA</p>
      <h2>Adicionar fazenda</h2>
      <form action={addFarm} className="inline-form">
        <input name="name" placeholder="Nome da fazenda" required />
        <input name="timezone" placeholder="Fuso horário" defaultValue="America/Sao_Paulo" />
        <button className="button" type="submit">Adicionar fazenda</button>
      </form>
    </section>
  </Shell>;
}
