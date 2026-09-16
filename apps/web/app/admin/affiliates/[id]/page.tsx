import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Shell } from "../../../components";
import { requirePlatformAdmin } from "../../../../lib/org-data";
import { createServiceClient } from "../../../../lib/supabase/service";
import { getLicensedMachineCount } from "../../../../lib/license";
import { buildReferralRows, releaseMaturedCommissions } from "../../../../lib/affiliate";
import { PayoutForm, CommissionActionButtons } from "./affiliate-actions";

const STATUS_LABEL: Record<string, string> = { pending: "Pendente", available: "Disponível", paid: "Pago", canceled: "Cancelado", reversed: "Revertido" };
const STATUS_BADGE: Record<string, string> = { pending: "warning", available: "success", paid: "success", canceled: "neutral", reversed: "neutral" };

function money(value: number) {
  return `USDT ${value.toFixed(2)}`;
}

export default async function AdminAffiliateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const service = createServiceClient();
  await releaseMaturedCommissions(service);

  const { data: affiliate } = await service.from("affiliate_profiles").select("id, user_id, affiliate_code, commission_rate, status, created_at").eq("id", id).maybeSingle();
  if (!affiliate) notFound();

  const [{ data: referrals }, { data: commissions }, { data: usersList }, { data: payouts }] = await Promise.all([
    service.from("affiliate_referrals").select("referred_user_id, referred_at").eq("affiliate_id", affiliate.id).order("referred_at", { ascending: false }),
    service.from("affiliate_commissions").select("id, referred_user_id, purchase_id, license_quantity, purchase_amount, commission_rate, commission_amount, status, purchase_date, available_at").eq("affiliate_id", affiliate.id).order("purchase_date", { ascending: false }),
    service.auth.admin.listUsers({ perPage: 1000 }),
    service.from("affiliate_payouts").select("id, amount, payment_method, payment_reference, notes, created_at").eq("affiliate_id", affiliate.id).order("created_at", { ascending: false }),
  ]);
  const payoutList = payouts ?? [];
  const referralList = referrals ?? [];
  const commissionList = commissions ?? [];
  const emailByUserId = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? "—"]));
  const affiliateEmail = emailByUserId.get(affiliate.user_id) ?? "—";

  const referredIds = referralList.map((r) => r.referred_user_id);
  const [{ data: referredProfiles }, { data: memberships }] = await Promise.all([
    referredIds.length ? service.from("profiles").select("id, full_name, created_at").in("id", referredIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; created_at: string }[] }),
    referredIds.length ? service.from("memberships").select("user_id, organization_id").in("user_id", referredIds).eq("role", "owner") : Promise.resolve({ data: [] as { user_id: string; organization_id: string }[] }),
  ]);
  const nameByUserId = new Map((referredProfiles ?? []).map((p) => [p.id, p.full_name || emailByUserId.get(p.id) || `Usuário #${p.id.slice(0, 6)}`]));
  const signupDateByUserId = new Map((referredProfiles ?? []).map((p) => [p.id, p.created_at]));
  const orgByUserId = new Map((memberships ?? []).map((m) => [m.user_id, m.organization_id]));
  const licensedCounts = await Promise.all([...orgByUserId.entries()].map(async ([userId, orgId]) => [userId, await getLicensedMachineCount(service, orgId)] as const));
  const licensedByUserId = new Map(licensedCounts);

  const referralRows = buildReferralRows(referralList, commissionList, nameByUserId);
  const availableCommissions = commissionList.filter((c) => c.status === "available").map((c) => ({ id: c.id, commission_amount: Number(c.commission_amount), purchase_date: c.purchase_date }));

  const activeCommissions = commissionList.filter((c) => c.status !== "canceled" && c.status !== "reversed");
  const totalReferred = referralList.length;
  const totalBuyers = referralRows.filter((r) => r.hasPurchased).length;
  const totalLicenses = activeCommissions.reduce((sum, c) => sum + c.license_quantity, 0);
  const totalVolume = activeCommissions.reduce((sum, c) => sum + Number(c.purchase_amount), 0);
  const totalPending = commissionList.filter((c) => c.status === "pending").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalAvailable = commissionList.filter((c) => c.status === "available").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalPaid = commissionList.filter((c) => c.status === "paid").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalCanceled = commissionList.filter((c) => c.status === "canceled" || c.status === "reversed").reduce((sum, c) => sum + Number(c.commission_amount), 0);

  return <Shell admin>
    <PageHeader title={affiliateEmail} description={`Afiliado desde ${new Date(affiliate.created_at).toLocaleDateString("pt-BR")} · código ${affiliate.affiliate_code} · taxa ${affiliate.commission_rate}%`} action={<Link href="/admin/affiliates" className="button secondary">← Voltar</Link>} />

    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">INDICADOS</p><div className="metric">{totalReferred}</div></article>
      <article className="card"><p className="eyebrow">COMPRADORES</p><div className="metric">{totalBuyers}</div></article>
      <article className="card"><p className="eyebrow">LICENÇAS VENDIDAS</p><div className="metric">{totalLicenses}</div></article>
      <article className="card"><p className="eyebrow">VOLUME TOTAL</p><div className="metric">{money(totalVolume)}</div></article>
      <article className="card"><p className="eyebrow">PENDENTE</p><div className="metric">{money(totalPending)}</div></article>
      <article className="card"><p className="eyebrow">DISPONÍVEL</p><div className="metric">{money(totalAvailable)}</div></article>
      <article className="card"><p className="eyebrow">PAGO</p><div className="metric">{money(totalPaid)}</div></article>
      <article className="card"><p className="eyebrow">CANCELADO/REVERTIDO</p><div className="metric">{money(totalCanceled)}</div></article>
    </section>

    <section className="card">
      <h2>Registrar pagamento</h2>
      <p className="muted">Selecione as comissões disponíveis que estão sendo pagas agora. Elas mudam para PAID e ficam amarradas a este pagamento.</p>
      <PayoutForm affiliateId={affiliate.id} available={availableCommissions} />
    </section>

    <section className="card table-card">
      <h2>Pagamentos registrados ({payoutList.length})</h2>
      {payoutList.length === 0
        ? <p className="muted">Nenhum pagamento registrado ainda.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Data</th><th>Valor</th><th>Método</th><th>Referência</th><th>Observação</th></tr></thead>
            <tbody>{payoutList.map((p) => <tr key={p.id}>
              <td>{new Date(p.created_at).toLocaleString("pt-BR")}</td>
              <td>{money(Number(p.amount))}</td>
              <td>{p.payment_method}</td>
              <td className="muted">{p.payment_reference ?? "—"}</td>
              <td className="muted">{p.notes ?? "—"}</td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    <section className="card table-card">
      <h2>Clientes indicados ({referralRows.length})</h2>
      {referralRows.length === 0
        ? <p className="muted">Nenhum cliente indicado ainda.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Nome</th><th>Indicado em</th><th>Cadastrado em</th><th>Licenças atuais</th><th>Compras</th><th>Licenças adquiridas</th><th>Volume gerado</th><th>Comissão gerada</th></tr></thead>
            <tbody>{referralRows.map((row) => <tr key={row.referredUserId}>
              <td>{row.name}</td>
              <td className="muted">{new Date(row.referredAt).toLocaleDateString("pt-BR")}</td>
              <td className="muted">{signupDateByUserId.has(row.referredUserId) ? new Date(signupDateByUserId.get(row.referredUserId)!).toLocaleDateString("pt-BR") : "—"}</td>
              <td>{licensedByUserId.get(row.referredUserId) ?? 0}</td>
              <td>{row.totalPurchases}</td>
              <td>{row.totalLicenses}</td>
              <td>{money(row.totalVolume)}</td>
              <td>{money(row.totalCommission)}</td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    <section className="card table-card">
      <h2>Histórico de comissões</h2>
      {commissionList.length === 0
        ? <p className="muted">Nenhuma comissão gerada ainda.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Data</th><th>Cliente</th><th>Compra</th><th>Licenças</th><th>Valor</th><th>Taxa</th><th>Comissão</th><th>Liberação</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>{commissionList.map((c) => <tr key={c.id}>
              <td>{new Date(c.purchase_date).toLocaleDateString("pt-BR")}</td>
              <td>{nameByUserId.get(c.referred_user_id) ?? "—"}</td>
              <td className="lm-mono">{c.purchase_id.slice(0, 8)}</td>
              <td>{c.license_quantity}</td>
              <td>{money(Number(c.purchase_amount))}</td>
              <td className="muted">{c.commission_rate}%</td>
              <td>{money(Number(c.commission_amount))}</td>
              <td className="muted">{new Date(c.available_at).toLocaleDateString("pt-BR")}</td>
              <td><span className={`badge ${STATUS_BADGE[c.status] ?? "neutral"}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
              <td><CommissionActionButtons commissionId={c.id} status={c.status} /></td>
            </tr>)}</tbody>
          </table></div>}
    </section>
  </Shell>;
}
