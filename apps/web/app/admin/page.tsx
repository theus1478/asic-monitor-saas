import { PageHeader, Shell } from "../components";
import { requirePlatformAdmin } from "../../lib/org-data";
import { createServiceClient } from "../../lib/supabase/service";
import { monthlyPriceCents } from "../../lib/pricing";
import { updateApiNinjasKey } from "./settings-actions";

function maskKey(key: string | null) {
  if (!key) return null;
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "…";
}

export default async function AdminPage() {
  await requirePlatformAdmin();
  const supabase = createServiceClient();
  const { data: settings } = await supabase.from("platform_settings").select("api_ninjas_key").eq("id", true).maybeSingle();
  const maskedKey = maskKey(settings?.api_ninjas_key ?? null);

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  const orgList = organizations ?? [];
  const orgIds = orgList.map((o) => o.id);

  const { data: farms } = orgIds.length
    ? await supabase.from("farms").select("id, organization_id").in("organization_id", orgIds)
    : { data: [] as { id: string; organization_id: string }[] };
  const farmList = farms ?? [];
  const farmIds = farmList.map((f) => f.id);
  const farmToOrg = new Map(farmList.map((f) => [f.id, f.organization_id]));

  const { data: miners } = farmIds.length
    ? await supabase.from("miners").select("id, farm_id").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string }[] };
  const minerList = miners ?? [];

  const { data: agents } = farmIds.length
    ? await supabase.from("agents").select("id, farm_id, status").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string; status: string }[] };
  const agentList = agents ?? [];

  const minersByOrg = new Map<string, number>();
  for (const m of minerList) {
    const orgId = farmToOrg.get(m.farm_id);
    if (orgId) minersByOrg.set(orgId, (minersByOrg.get(orgId) ?? 0) + 1);
  }

  const onlineAgents = agentList.filter((a) => a.status === "online").length;
  const totalMrrCents = orgList.reduce((sum, o) => sum + monthlyPriceCents(minersByOrg.get(o.id) ?? 0), 0);

  return <Shell admin>
    <PageHeader title="Gestão da plataforma" description="Acompanhe clientes, máquinas e agentes de toda a operação." />
    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">CLIENTES</p><div className="metric">{orgList.length}</div><p className="muted">organizações cadastradas</p></article>
      <article className="card"><p className="eyebrow">MÁQUINAS CADASTRADAS</p><div className="metric">{minerList.length}</div><p className="muted">em todas as contas</p></article>
      <article className="card"><p className="eyebrow">AGENTES ONLINE</p><div className="metric">{onlineAgents}<span>/{agentList.length}</span></div><p className="muted">coletores ativos agora</p></article>
      <article className="card"><p className="eyebrow">MRR ESTIMADO</p><div className="metric">USDT {(totalMrrCents / 100).toFixed(2)}</div><p className="muted">pela régua de preço atual</p></article>
    </section>
    <section id="clientes" className="card table-card">
      <div className="section-title"><div><h2>Clientes</h2><p>Organizações e máquinas cadastradas</p></div></div>
      {orgList.length === 0
        ? <p className="muted">Nenhuma organização cadastrada ainda.</p>
        : <div className="table-wrap">
            <table>
              <thead><tr><th>Organização</th><th>Máquinas</th><th>Estimativa mensal</th><th>Criada em</th></tr></thead>
              <tbody>
                {orgList.map((org) => {
                  const machines = minersByOrg.get(org.id) ?? 0;
                  return <tr key={org.id}>
                    <td><b>{org.name}</b></td>
                    <td>{machines}</td>
                    <td>USDT {(monthlyPriceCents(machines) / 100).toFixed(2)}</td>
                    <td>{new Date(org.created_at).toLocaleDateString("pt-BR")}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
    </section>
    <section id="licencas" className="card">
      <h2>Licenciamento</h2>
      <p className="muted">Cada máquina cadastrada conta para a licença da organização. A régua de desconto progressivo é a mesma usada na calculadora de cobrança do cliente.</p>
    </section>
    <section id="api-ninjas" className="card setup">
      <p className="eyebrow">COTAÇÃO DE BTC</p>
      <h2>Chave da API-Ninjas</h2>
      <p className="muted">Usada na aba Rendimento de todos os clientes para buscar a cotação do BTC automaticamente (com CoinGecko como reserva, sem gastar cota). {maskedKey ? <>Chave atual: <b>{maskedKey}</b>.</> : "Nenhuma chave cadastrada — a cotação em USD/USDT cai para o CoinGecko."}</p>
      <form action={updateApiNinjasKey} className="inline-form">
        <input name="api_ninjas_key" placeholder="Chave da api-ninjas.com" autoComplete="off" />
        <button className="button secondary" type="submit">Salvar chave</button>
      </form>
    </section>
  </Shell>;
}
