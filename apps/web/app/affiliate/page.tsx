import { redirect } from "next/navigation";
import { PageHeader, Shell } from "../components";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";
import { buildReferralRows, getOrCreateAffiliateProfile, maskReferredName, releaseMaturedCommissions, type CommissionRow } from "../../lib/affiliate";
import { CopyButton, ShareButton } from "./copy-buttons";

const STATUS_LABEL: Record<string, string> = { pending: "Pendente", available: "Disponível", paid: "Pago", canceled: "Cancelado", reversed: "Revertido" };
const STATUS_BADGE: Record<string, string> = { pending: "warning", available: "success", paid: "success", canceled: "neutral", reversed: "neutral" };

function money(value: number) {
  return `USDT ${value.toFixed(2)}`;
}

export default async function AffiliatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const service = createServiceClient();
  await releaseMaturedCommissions(service);

  const profile = await getOrCreateAffiliateProfile(supabase, user.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const referralLink = `${appUrl}/sign-in?mode=signup&ref=${profile.affiliate_code}`;

  const [{ data: referrals }, { data: commissions }] = await Promise.all([
    supabase.from("affiliate_referrals").select("referred_user_id, referred_at").eq("affiliate_id", profile.id).order("referred_at", { ascending: false }),
    supabase.from("affiliate_commissions").select("id, referred_user_id, purchase_id, license_quantity, purchase_amount, commission_rate, commission_amount, status, purchase_date, available_at").eq("affiliate_id", profile.id).order("purchase_date", { ascending: false }),
  ]);
  const referralList = referrals ?? [];
  const commissionList = commissions ?? [];

  const referredIds = referralList.map((r) => r.referred_user_id);
  const { data: referredProfiles } = referredIds.length
    ? await service.from("profiles").select("id, full_name").in("id", referredIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameByUserId = new Map((referredProfiles ?? []).map((p) => [p.id, maskReferredName(p.full_name, p.id)]));

  const referralRows = buildReferralRows(referralList, commissionList, nameByUserId);
  const commissionRows: CommissionRow[] = commissionList.map((c) => ({
    id: c.id,
    referredUserId: c.referred_user_id,
    referredName: nameByUserId.get(c.referred_user_id) ?? `Cliente #${c.referred_user_id.slice(0, 6)}`,
    purchaseId: c.purchase_id,
    licenseQuantity: c.license_quantity,
    purchaseAmount: Number(c.purchase_amount),
    commissionRate: Number(c.commission_rate),
    commissionAmount: Number(c.commission_amount),
    purchaseDate: c.purchase_date,
    availableAt: c.available_at,
    status: c.status,
  }));

  const activeCommissions = commissionList.filter((c) => c.status !== "canceled" && c.status !== "reversed");
  const totalReferred = referralList.length;
  const payingCustomers = referralRows.filter((r) => r.hasPurchased).length;
  const totalLicenses = activeCommissions.reduce((sum, c) => sum + c.license_quantity, 0);
  const pendingTotal = commissionList.filter((c) => c.status === "pending").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const availableTotal = commissionList.filter((c) => c.status === "available").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const paidTotal = commissionList.filter((c) => c.status === "paid").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const historicalTotal = activeCommissions.reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalVolume = activeCommissions.reduce((sum, c) => sum + Number(c.purchase_amount), 0);

  return <Shell>
    <PageHeader title="Programa de Indicações" description={`Indique novos clientes e receba ${profile.commission_rate}% sobre o que eles gastarem em licenças.`} />

    <section className="card setup">
      <p className="eyebrow">SEU CÓDIGO DE INDICAÇÃO</p>
      <h2>{profile.affiliate_code}</h2>
      <div className="inline-form"><CopyButton value={profile.affiliate_code} label="Copiar código" copiedLabel="Copiado!" /></div>
      <p className="muted" style={{ marginTop: 18 }}>Link de indicação</p>
      <code className="token-code">{referralLink}</code>
      <div className="inline-form">
        <CopyButton value={referralLink} label="Copiar link" copiedLabel="Copiado!" />
        <ShareButton url={referralLink} title="ASIC Monitor Cloud" label="Compartilhar" />
      </div>
    </section>

    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">TOTAL DE INDICADOS</p><div className="metric">{totalReferred}</div></article>
      <article className="card"><p className="eyebrow">CLIENTES PAGANTES</p><div className="metric">{payingCustomers}</div></article>
      <article className="card"><p className="eyebrow">LICENÇAS ADQUIRIDAS</p><div className="metric">{totalLicenses}</div></article>
      <article className="card"><p className="eyebrow">VOLUME GERADO</p><div className="metric">{money(totalVolume)}</div></article>
      <article className="card"><p className="eyebrow">COMISSÕES PENDENTES</p><div className="metric">{money(pendingTotal)}</div><p className="muted">em carência de 30 dias</p></article>
      <article className="card"><p className="eyebrow">COMISSÕES DISPONÍVEIS</p><div className="metric">{money(availableTotal)}</div></article>
      <article className="card"><p className="eyebrow">COMISSÕES PAGAS</p><div className="metric">{money(paidTotal)}</div></article>
      <article className="card"><p className="eyebrow">TOTAL HISTÓRICO</p><div className="metric">{money(historicalTotal)}</div></article>
    </section>

    <section className="card table-card">
      <div className="section-title"><div><h2>Seus indicados</h2><p>Cada linha soma todas as compras de um mesmo cliente.</p></div></div>
      {referralRows.length === 0
        ? <p className="muted">Ninguém se cadastrou com o seu código ainda.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Cliente</th><th>Indicado em</th><th>Licenças</th><th>Compras</th><th>Volume</th><th>Comissão total</th><th>Pendente</th><th>Disponível</th><th>Próxima liberação</th></tr></thead>
            <tbody>{referralRows.map((row) => <tr key={row.referredUserId}>
              <td>{row.name}</td>
              <td className="muted">{new Date(row.referredAt).toLocaleDateString("pt-BR")}</td>
              <td>{row.totalLicenses}</td>
              <td>{row.totalPurchases}</td>
              <td>{money(row.totalVolume)}</td>
              <td>{money(row.totalCommission)}</td>
              <td>{money(row.pendingCommission)}</td>
              <td>{money(row.availableCommission)}</td>
              <td className="muted">{row.nextReleaseAt ? new Date(row.nextReleaseAt).toLocaleDateString("pt-BR") : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    <section className="card table-card">
      <div className="section-title"><div><h2>Histórico de comissões</h2><p>Uma linha por compra confirmada dos seus indicados.</p></div></div>
      {commissionRows.length === 0
        ? <p className="muted">Nenhuma comissão gerada ainda.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Data</th><th>Cliente</th><th>Licenças</th><th>Valor da compra</th><th>Taxa</th><th>Comissão</th><th>Liberação</th><th>Status</th></tr></thead>
            <tbody>{commissionRows.map((row) => <tr key={row.id}>
              <td>{new Date(row.purchaseDate).toLocaleDateString("pt-BR")}</td>
              <td>{row.referredName}</td>
              <td>{row.licenseQuantity}</td>
              <td>{money(row.purchaseAmount)}</td>
              <td className="muted">{row.commissionRate}%</td>
              <td>{money(row.commissionAmount)}</td>
              <td className="muted">{new Date(row.availableAt).toLocaleDateString("pt-BR")}</td>
              <td><span className={`badge ${STATUS_BADGE[row.status] ?? "neutral"}`}>{STATUS_LABEL[row.status] ?? row.status}</span></td>
            </tr>)}</tbody>
          </table></div>}
    </section>
  </Shell>;
}
