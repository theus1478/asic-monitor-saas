import Link from "next/link";
import { PageHeader, Shell } from "../../components";
import { requirePlatformAdmin } from "../../../lib/org-data";
import { createServiceClient } from "../../../lib/supabase/service";
import { getAffiliateSettings, releaseMaturedCommissions } from "../../../lib/affiliate";
import { updateAffiliateSettings } from "./actions";

function money(value: number) {
  return `USDT ${value.toFixed(2)}`;
}

export default async function AdminAffiliatesPage() {
  await requirePlatformAdmin();
  const service = createServiceClient();
  await releaseMaturedCommissions(service);
  const settings = await getAffiliateSettings(service);

  const [{ data: affiliates }, { data: referrals }, { data: commissions }, { data: usersList }] = await Promise.all([
    service.from("affiliate_profiles").select("id, user_id, affiliate_code, commission_rate, status, created_at").order("created_at", { ascending: false }),
    service.from("affiliate_referrals").select("affiliate_id, referred_user_id"),
    service.from("affiliate_commissions").select("affiliate_id, referred_user_id, license_quantity, purchase_amount, commission_amount, status"),
    service.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const emailByUserId = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? "—"]));
  const affiliateList = affiliates ?? [];
  const referralList = referrals ?? [];
  const commissionList = commissions ?? [];
  const activeCommissions = commissionList.filter((c) => c.status !== "canceled" && c.status !== "reversed");

  const referredByAffiliate = new Map<string, Set<string>>();
  for (const r of referralList) {
    if (!referredByAffiliate.has(r.affiliate_id)) referredByAffiliate.set(r.affiliate_id, new Set());
    referredByAffiliate.get(r.affiliate_id)!.add(r.referred_user_id);
  }
  const payersByAffiliate = new Map<string, Set<string>>();
  for (const c of activeCommissions) {
    if (!payersByAffiliate.has(c.affiliate_id)) payersByAffiliate.set(c.affiliate_id, new Set());
    payersByAffiliate.get(c.affiliate_id)!.add(c.referred_user_id);
  }

  const rows = affiliateList.map((affiliate) => {
    const own = commissionList.filter((c) => c.affiliate_id === affiliate.id);
    const activeOwn = own.filter((c) => c.status !== "canceled" && c.status !== "reversed");
    return {
      ...affiliate,
      email: emailByUserId.get(affiliate.user_id) ?? "—",
      referredCount: referredByAffiliate.get(affiliate.id)?.size ?? 0,
      payingCount: payersByAffiliate.get(affiliate.id)?.size ?? 0,
      licenses: activeOwn.reduce((sum, c) => sum + c.license_quantity, 0),
      volume: activeOwn.reduce((sum, c) => sum + Number(c.purchase_amount), 0),
      pending: own.filter((c) => c.status === "pending").reduce((sum, c) => sum + Number(c.commission_amount), 0),
      available: own.filter((c) => c.status === "available").reduce((sum, c) => sum + Number(c.commission_amount), 0),
      paid: own.filter((c) => c.status === "paid").reduce((sum, c) => sum + Number(c.commission_amount), 0),
    };
  });

  const totalAffiliates = affiliateList.length;
  const totalReferred = new Set(referralList.map((r) => r.referred_user_id)).size;
  const totalBuyers = new Set(activeCommissions.map((c) => c.referred_user_id)).size;
  const totalLicenses = activeCommissions.reduce((sum, c) => sum + c.license_quantity, 0);
  const totalVolume = activeCommissions.reduce((sum, c) => sum + Number(c.purchase_amount), 0);
  const totalPending = commissionList.filter((c) => c.status === "pending").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalAvailable = commissionList.filter((c) => c.status === "available").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalPaid = commissionList.filter((c) => c.status === "paid").reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const totalCanceled = commissionList.filter((c) => c.status === "canceled" || c.status === "reversed").reduce((sum, c) => sum + Number(c.commission_amount), 0);

  return <Shell admin>
    <PageHeader title="Financeiro › Indicações" description="Indicações, comissões e pagamentos do programa de indicações." />
    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">INDICADORES</p><div className="metric">{totalAffiliates}</div></article>
      <article className="card"><p className="eyebrow">USUÁRIOS INDICADOS</p><div className="metric">{totalReferred}</div></article>
      <article className="card"><p className="eyebrow">COMPRADORES INDICADOS</p><div className="metric">{totalBuyers}</div></article>
      <article className="card"><p className="eyebrow">LICENÇAS VIA INDICAÇÕES</p><div className="metric">{totalLicenses}</div></article>
      <article className="card"><p className="eyebrow">VOLUME GERADO</p><div className="metric">{money(totalVolume)}</div></article>
      <article className="card"><p className="eyebrow">COMISSÕES PENDENTES</p><div className="metric">{money(totalPending)}</div></article>
      <article className="card"><p className="eyebrow">COMISSÕES DISPONÍVEIS</p><div className="metric">{money(totalAvailable)}</div></article>
      <article className="card"><p className="eyebrow">COMISSÕES PAGAS</p><div className="metric">{money(totalPaid)}</div><p className="muted">canceladas/revertidas: {money(totalCanceled)}</p></article>
    </section>

    <section className="card table-card">
      <div className="section-title"><div><h2>Indicadores</h2><p>Clique para ver o detalhe de indicados e registrar pagamentos.</p></div></div>
      {rows.length === 0
        ? <p className="muted">Nenhum indicador ainda — o perfil é criado automaticamente quando um usuário abre o painel de indicações dele.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Indicador</th><th>Código</th><th>Indicados</th><th>Pagantes</th><th>Licenças vendidas</th><th>Volume</th><th>Pendente</th><th>Disponível</th><th>Pago</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}>
              <td><Link href={`/admin/affiliates/${row.id}`}><b>{row.email}</b></Link></td>
              <td className="lm-mono">{row.affiliate_code}</td>
              <td>{row.referredCount}</td>
              <td>{row.payingCount}</td>
              <td>{row.licenses}</td>
              <td>{money(row.volume)}</td>
              <td>{money(row.pending)}</td>
              <td>{money(row.available)}</td>
              <td>{money(row.paid)}</td>
              <td><span className={`badge ${row.status === "active" ? "success" : "neutral"}`}>{row.status === "active" ? "Ativo" : "Suspenso"}</span></td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    <section className="card setup">
      <p className="eyebrow">CONFIGURAÇÃO DO PROGRAMA</p>
      <h2>Regras de comissão</h2>
      <p className="muted">Vale só para novos indicadores e novas comissões a partir de agora — nada é recalculado retroativamente.</p>
      <form action={updateAffiliateSettings} className="inline-form" style={{ flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Taxa padrão (%)<input name="commissionRate" type="number" min="0" max="100" step="0.01" defaultValue={settings.affiliate_default_commission_rate} required /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Carência (dias)<input name="holdDays" type="number" min="0" defaultValue={settings.affiliate_hold_period_days} required /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Validade da indicação (dias)<input name="validityDays" type="number" min="0" defaultValue={settings.affiliate_referral_validity_days} required /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input name="enabled" type="checkbox" defaultChecked={settings.affiliate_program_enabled} /> Programa ativo</label>
        <button className="button secondary" type="submit">Salvar</button>
      </form>
    </section>
  </Shell>;
}
