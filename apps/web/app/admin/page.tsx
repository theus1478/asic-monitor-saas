import Link from "next/link";
import { PageHeader, Shell } from "../components";
import { requirePlatformAdmin } from "../../lib/org-data";
import { createServiceClient } from "../../lib/supabase/service";
import { getLicensedMachineCount } from "../../lib/license";
import { monthlyPriceCents } from "../../lib/pricing";
import { currentTimeMs } from "../../lib/time";
import { updateApiNinjasKey } from "./settings-actions";

function maskKey(key: string | null) {
  if (!key) return null;
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "…";
}

function formatHashrate(ths: number) {
  if (ths >= 1000) return `${(ths / 1000).toFixed(2)} PH/s`;
  return `${ths.toFixed(2)} TH/s`;
}

const INVOICE_LABEL: Record<string, string> = { paid: "Pago", pending: "Pendente", expired: "Expirada", cancelled: "Cancelada" };

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

  const [{ data: farms }, { data: memberships }, { data: usersList }, { data: invoices }, licensedCounts] = await Promise.all([
    orgIds.length ? supabase.from("farms").select("id, organization_id").in("organization_id", orgIds) : Promise.resolve({ data: [] as { id: string; organization_id: string }[] }),
    orgIds.length ? supabase.from("memberships").select("organization_id, user_id, role").in("organization_id", orgIds) : Promise.resolve({ data: [] as { organization_id: string; user_id: string; role: string }[] }),
    supabase.auth.admin.listUsers({ perPage: 1000 }),
    orgIds.length ? supabase.from("invoices").select("organization_id, status, amount_usdt, created_at, paid_at").in("organization_id", orgIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { organization_id: string; status: string; amount_usdt: number; created_at: string; paid_at: string | null }[] }),
    Promise.all(orgIds.map((id) => getLicensedMachineCount(supabase, id))),
  ]);

  const farmList = farms ?? [];
  const farmIds = farmList.map((f) => f.id);
  const farmToOrg = new Map(farmList.map((f) => [f.id, f.organization_id]));
  const licensedByOrg = new Map(orgIds.map((id, index) => [id, licensedCounts[index]]));

  const emailByUserId = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? "—"]));
  const ownerEmailByOrg = new Map<string, string>();
  for (const m of memberships ?? []) {
    if (m.role === "owner" || !ownerEmailByOrg.has(m.organization_id)) {
      ownerEmailByOrg.set(m.organization_id, emailByUserId.get(m.user_id) ?? "—");
    }
  }

  const latestInvoiceByOrg = new Map<string, { status: string; amount_usdt: number; created_at: string }>();
  for (const inv of invoices ?? []) {
    if (!latestInvoiceByOrg.has(inv.organization_id)) latestInvoiceByOrg.set(inv.organization_id, inv);
  }

  const { data: miners } = farmIds.length
    ? await supabase.from("miners").select("id, farm_id").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string }[] };
  const minerList = miners ?? [];
  const minerIds = minerList.map((m) => m.id);
  const minerToOrg = new Map(minerList.map((m) => [m.id, farmToOrg.get(m.farm_id)]));

  const { data: agents } = farmIds.length
    ? await supabase.from("agents").select("id, farm_id, status").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string; status: string }[] };
  const agentList = agents ?? [];

  const { data: recentMetrics } = minerIds.length
    ? await supabase.from("miner_metrics").select("miner_id, online, hashrate_ths, observed_at").in("miner_id", minerIds).order("observed_at", { ascending: false }).limit(Math.max(2000, minerIds.length * 3))
    : { data: [] as { miner_id: string; online: boolean; hashrate_ths: number | null; observed_at: string }[] };
  const latestMetricByMiner = new Map<string, { online: boolean; hashrate_ths: number | null; observed_at: string }>();
  for (const metric of recentMetrics ?? []) {
    if (!latestMetricByMiner.has(metric.miner_id)) latestMetricByMiner.set(metric.miner_id, metric);
  }
  const FRESH_MS = 90_000;
  const now = currentTimeMs();
  const hashrateByOrg = new Map<string, number>();
  for (const miner of minerList) {
    const metric = latestMetricByMiner.get(miner.id);
    const fresh = Boolean(metric && now - new Date(metric.observed_at).getTime() <= FRESH_MS);
    if (metric?.online && fresh && typeof metric.hashrate_ths === "number") {
      const orgId = minerToOrg.get(miner.id);
      if (orgId) hashrateByOrg.set(orgId, (hashrateByOrg.get(orgId) ?? 0) + metric.hashrate_ths);
    }
  }
  const totalHashrateThs = [...hashrateByOrg.values()].reduce((sum, v) => sum + v, 0);

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
      <article className="card"><p className="eyebrow">HASHRATE TOTAL</p><div className="metric">{formatHashrate(totalHashrateThs)}</div><p className="muted">soma de todas as contas online</p></article>
      <article className="card"><p className="eyebrow">AGENTES ONLINE</p><div className="metric">{onlineAgents}<span>/{agentList.length}</span></div><p className="muted">coletores ativos agora</p></article>
      <article className="card"><p className="eyebrow">MRR ESTIMADO</p><div className="metric">USDT {(totalMrrCents / 100).toFixed(2)}</div><p className="muted">pela régua de preço atual</p></article>
    </section>
    <section id="clientes" className="card table-card">
      <div className="section-title"><div><h2>Clientes</h2><p>Organizações, máquinas e faturamento — clique para ver o detalhe de cada uma</p></div></div>
      {orgList.length === 0
        ? <p className="muted">Nenhuma organização cadastrada ainda.</p>
        : <div className="table-wrap">
            <table>
              <thead><tr><th>Organização</th><th>E-mail</th><th>Máquinas</th><th>Hashrate</th><th>Licenças</th><th>Última fatura</th><th>Criada em</th></tr></thead>
              <tbody>
                {orgList.map((org) => {
                  const machines = minersByOrg.get(org.id) ?? 0;
                  const hashrate = hashrateByOrg.get(org.id) ?? 0;
                  const invoice = latestInvoiceByOrg.get(org.id);
                  return <tr key={org.id}>
                    <td><Link href={`/admin/orgs/${org.id}`}><b>{org.name}</b></Link></td>
                    <td className="lm-dim">{ownerEmailByOrg.get(org.id) ?? "—"}</td>
                    <td>{machines}</td>
                    <td>{hashrate > 0 ? formatHashrate(hashrate) : "—"}</td>
                    <td>{licensedByOrg.get(org.id) ?? 0}</td>
                    <td>{invoice ? <span className={`badge ${invoice.status === "paid" ? "success" : invoice.status === "pending" ? "warning" : "neutral"}`}>{INVOICE_LABEL[invoice.status] ?? invoice.status}</span> : <span className="muted">—</span>}</td>
                    <td>{new Date(org.created_at).toLocaleDateString("pt-BR")}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
    </section>
    <section id="licencas" className="card">
      <h2>Licenciamento</h2>
      <p className="muted">Toda conta nova ganha 3 licenças grátis por 30 dias ao se cadastrar. Cada máquina cadastrada conta para a licença da organização, e a régua de desconto progressivo é a mesma usada na calculadora de cobrança do cliente.</p>
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
