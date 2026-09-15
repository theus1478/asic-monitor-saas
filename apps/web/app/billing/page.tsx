import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { BillingCalculator } from "./billing-calculator";

type Props = { searchParams: Promise<{ invoice?: string; error?: string; payment?: string }> };
type Batch = { id: string; quantity: number; status: string; starts_at: string | null; expires_at: string | null; created_at: string };
const currentTime = () => Date.now();

export default async function BillingPage({ searchParams }: Props) {
  const params = await searchParams;
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const { supabase, organizationId } = await getOrganizationId();
  const { data: farms } = organizationId ? await supabase.from("farms").select("id").eq("organization_id", organizationId) : { data: [] };
  const farmIds = (farms ?? []).map((farm) => farm.id);
  const [{ count }, { data: batches }, { data: invoice }] = await Promise.all([
    farmIds.length ? supabase.from("miners").select("id", { count: "exact", head: true }).in("farm_id", farmIds) : Promise.resolve({ count: 0 }),
    organizationId ? supabase.from("license_batches").select("id, quantity, status, starts_at, expires_at, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    params.invoice && organizationId ? supabase.from("invoices").select("id, reference, amount_usdt, wallet_address, status, due_at").eq("id", params.invoice).eq("organization_id", organizationId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const now = currentTime();
  const batchList = (batches ?? []) as Batch[];
  const active = batchList.filter((batch) => batch.status === "active" && batch.expires_at && new Date(batch.expires_at).getTime() > now);
  const activeLicenses = active.reduce((sum, batch) => sum + batch.quantity, 0);

  return <Shell><PageHeader title={t("title")} description={t("description")} />
    {params.error && <div className="form-message error">{params.error}</div>}
    {params.payment === "confirmed" && <div className="form-message success">{t("paymentConfirmed")}</div>}
    <section className="license-summary"><article className="card"><p className="eyebrow">{t("activeLicenses")}</p><div className="metric">{activeLicenses}</div><p className="muted">{t("currentCapacity")}</p></article><article className="card"><p className="eyebrow">{t("registeredMachines")}</p><div className="metric">{count ?? 0}</div><p className="muted">{t("slotsAvailable", { count: Math.max(0, activeLicenses - (count ?? 0)) })}</p></article><article className="card"><p className="eyebrow">{t("activeBatches")}</p><div className="metric">{active.length}</div><p className="muted">{t("eachBatchExpires")}</p></article></section>
    <BillingCalculator usedMachines={count ?? 0} activeLicenses={activeLicenses} pendingInvoice={invoice ? { ...invoice, amount_usdt: Number(invoice.amount_usdt) } : null} />
    <section className="card license-batches"><div className="section-title"><div><h2>{t("validityTitle")}</h2><p>{t("validityBody")}</p></div></div>{batchList.length === 0 ? <p className="muted">{t("noLicensesYet")}</p> : <div className="batch-list">{batchList.map((batch) => {
      const start = batch.starts_at ? new Date(batch.starts_at).getTime() : null, end = batch.expires_at ? new Date(batch.expires_at).getTime() : null;
      const progress = start && end ? Math.max(0, Math.min(100, ((end - now) / (end - start)) * 100)) : 0;
      const days = end ? Math.max(0, Math.ceil((end - now) / 86400_000)) : null;
      const effectiveStatus = batch.status === "active" && end && end <= now ? "expired" : batch.status;
      return <article key={batch.id} className="batch-row"><div><b>{t("licenseCount", { count: batch.quantity })}</b><span className={`badge ${effectiveStatus === "active" ? "success" : effectiveStatus === "pending" ? "warning" : "neutral"}`}>{effectiveStatus === "active" ? t("statusActive") : effectiveStatus === "pending" ? t("statusPending") : t("statusExpired")}</span></div><div className="expiry-meta"><span>{days == null ? t("activeAfterConfirmation") : t("daysRemaining", { count: days })}</span><small>{batch.expires_at ? t("expiresOn", { date: new Date(batch.expires_at).toLocaleDateString(locale) }) : t("validity30Days")}</small></div><div className="expiry-track"><i style={{ width: `${progress}%` }} /></div></article>;
    })}</div>}</section>
  </Shell>;
}
