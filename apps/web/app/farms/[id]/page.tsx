import { notFound } from "next/navigation";
import { PageHeader, Shell } from "../../components";
import { createClient } from "../../../lib/supabase/server";
import { addMiner } from "../actions";
import { CreateAgentPanel } from "../create-agent-panel";

export default async function FarmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: farm } = await supabase.from("farms").select("id, name, timezone").eq("id", id).maybeSingle();
  if (!farm) notFound();

  const { data: miners } = await supabase
    .from("miners")
    .select("id, name, ip, protocol_port, enabled")
    .eq("farm_id", id)
    .order("created_at");

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, status, last_seen_at")
    .eq("farm_id", id)
    .order("id");

  const addMinerForFarm = addMiner.bind(null, id);
  const minerList = miners ?? [];

  return <Shell>
    <PageHeader title={farm.name} description={`Fuso horário: ${farm.timezone}`} />
    <section className="card table-card">
      <h2>Máquinas cadastradas</h2>
      {minerList.length === 0
        ? <p className="muted">Nenhuma máquina cadastrada ainda.</p>
        : <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>IP</th><th>Porta</th></tr></thead>
              <tbody>{minerList.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.ip}</td><td>{m.protocol_port}</td></tr>)}</tbody>
            </table>
          </div>}
      <form action={addMinerForFarm} className="inline-form">
        <input name="name" placeholder="Nome (ex: ASIC-01)" required />
        <input name="ip" placeholder="IP local (ex: 192.168.1.101)" required />
        <input name="port" placeholder="Porta" defaultValue={4028} />
        <button className="button secondary" type="submit">Adicionar máquina</button>
      </form>
    </section>
    <CreateAgentPanel farmId={farm.id} agents={agents ?? []} />
  </Shell>;
}
