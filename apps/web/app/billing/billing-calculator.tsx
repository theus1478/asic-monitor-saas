"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { averageUnitPriceCents, buildSolanaPayUri, monthlyPriceCents } from "../../lib/pricing";
import { createLicensePurchase, verifyLicensePurchase } from "./actions";

type Invoice = { id: string; reference: string; amount_usdt: number; wallet_address: string; status: string; due_at: string };

export function BillingCalculator({ usedMachines, activeLicenses, pendingInvoice }: { usedMachines: number; activeLicenses: number; pendingInvoice: Invoice | null }) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const [quantity, setQuantity] = useState(Math.max(1, usedMachines - activeLicenses || 1));
  const [qr, setQr] = useState<string | null>(null), [copied, setCopied] = useState(false), [amountCopied, setAmountCopied] = useState(false);
  const amount = useMemo(() => monthlyPriceCents(quantity) / 100, [quantity]);
  const average = useMemo(() => averageUnitPriceCents(quantity) / 100, [quantity]);
  const uri = useMemo(() => pendingInvoice ? buildSolanaPayUri(pendingInvoice.amount_usdt, pendingInvoice.reference, pendingInvoice.wallet_address) : null, [pendingInvoice]);
  useEffect(() => { if (!uri) return; let cancelled = false; QRCode.toDataURL(uri, { margin: 1, width: 260, color: { dark: "#07110c", light: "#e7fbf3" } }).then((url) => { if (!cancelled) setQr(url); }); return () => { cancelled = true; }; }, [uri]);
  async function copy() { if (!pendingInvoice) return; await navigator.clipboard.writeText(pendingInvoice.wallet_address); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
  async function copyAmount() { if (!pendingInvoice) return; await navigator.clipboard.writeText(pendingInvoice.amount_usdt.toFixed(6)); setAmountCopied(true); window.setTimeout(() => setAmountCopied(false), 1800); }

  return <>
    <section className="card calculator-card refined-calculator"><div className="calculator-copy"><p className="eyebrow">{t("newBatchEyebrow")}</p><h2>{t("howManyMachines")}</h2><p className="muted">{t("calculatorBody")}</p></div><form action={createLicensePurchase} className="purchase-form"><label>{t("quantity")}<input name="quantity" type="number" min="1" max="9999" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(9999, Math.round(+event.target.value || 1))))} /></label><div className="purchase-total"><span>{t("totalFor30Days")}</span><strong>USDT {amount.toFixed(2)}</strong><small>{t("perLicense", { amount: average.toFixed(2) })}</small></div><button className="button" type="submit">{t("generateCharge")}</button></form><div className="tier-track"><span><b>{t("flatPrice")}</b></span></div></section>
    {pendingInvoice && <section className="invoice-grid"><article className="card invoice-card"><p className="eyebrow">{t("chargeGeneratedEyebrow")}</p><h2>USDT {pendingInvoice.amount_usdt.toFixed(6)}</h2><button className="button secondary compact" type="button" onClick={copyAmount}>{amountCopied ? t("addressCopied") : t("copyAmount")}</button><p>{t("sendExactAmount")}</p><span className="badge warning">{t("awaitingConfirmation")}</span><dl><div><dt>{t("chargeValidity")}</dt><dd>{new Date(pendingInvoice.due_at).toLocaleString(locale)}</dd></div><div><dt>{t("network")}</dt><dd>Solana</dd></div><div><dt>{t("reference")}</dt><dd>{pendingInvoice.reference.slice(0, 18)}…</dd></div></dl><form action={verifyLicensePurchase.bind(null, pendingInvoice.id)}><button className="button" type="submit">{t("verifyPayment")}</button></form></article><article className="card pay-card"><p className="eyebrow">{t("payInUsdtEyebrow")}</p>{qr ? <Image src={qr} alt="QR code de pagamento Solana Pay" width={172} height={172} unoptimized className="qr-code" /> : <div className="qr-placeholder"><span>USDT</span></div>}<p>{t("afterConfirmation")}</p><code>{pendingInvoice.wallet_address}</code><button className="button secondary" type="button" onClick={copy}>{copied ? t("addressCopied") : t("copyAddress")}</button></article></section>}
  </>;
}
