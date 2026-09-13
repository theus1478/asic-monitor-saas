"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { averageUnitPriceCents, BILLING_WALLET_PUBLIC_KEY, buildSolanaPayUri, monthlyPriceCents } from "../../lib/pricing";
import { createLicensePurchase, verifyLicensePurchase } from "./actions";

type Invoice = { id: string; reference: string; amount_usdt: number; wallet_address: string; status: string; due_at: string };

export function BillingCalculator({ usedMachines, activeLicenses, pendingInvoice }: { usedMachines: number; activeLicenses: number; pendingInvoice: Invoice | null }) {
  const [quantity, setQuantity] = useState(Math.max(1, usedMachines - activeLicenses || 1));
  const [qr, setQr] = useState<string | null>(null), [copied, setCopied] = useState(false);
  const amount = useMemo(() => monthlyPriceCents(quantity) / 100, [quantity]);
  const average = useMemo(() => averageUnitPriceCents(quantity) / 100, [quantity]);
  const uri = useMemo(() => pendingInvoice ? buildSolanaPayUri(pendingInvoice.amount_usdt, pendingInvoice.reference) : null, [pendingInvoice]);
  useEffect(() => { if (!uri) return; let cancelled = false; QRCode.toDataURL(uri, { margin: 1, width: 260, color: { dark: "#07110c", light: "#e7fbf3" } }).then((url) => { if (!cancelled) setQr(url); }); return () => { cancelled = true; }; }, [uri]);
  async function copy() { await navigator.clipboard.writeText(BILLING_WALLET_PUBLIC_KEY); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }

  return <>
    <section className="card calculator-card refined-calculator"><div className="calculator-copy"><p className="eyebrow">NOVO LOTE DE LICENÇAS</p><h2>Quantas máquinas deseja adicionar?</h2><p className="muted">O desconto é progressivo e calculado dentro do lote. A validade começa quando o pagamento for confirmado.</p></div><form action={createLicensePurchase} className="purchase-form"><label>Quantidade<input name="quantity" type="number" min="1" max="9999" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(9999, Math.round(+event.target.value || 1))))} /></label><div className="purchase-total"><span>Total por 30 dias</span><strong>USDT {amount.toFixed(2)}</strong><small>USDT {average.toFixed(2)} por licença</small></div><button className="button" type="submit">Gerar cobrança</button></form><div className="tier-track"><span><b>1–14</b> US$ 3,00</span><span><b>15–49</b> US$ 2,70</span><span><b>50–99</b> US$ 2,40</span><span><b>100+</b> US$ 2,10</span></div></section>
    {pendingInvoice && <section className="invoice-grid"><article className="card invoice-card"><p className="eyebrow">COBRANÇA GERADA</p><h2>USDT {pendingInvoice.amount_usdt.toFixed(2)}</h2><p>Envie o valor exato usando a rede Solana.</p><span className="badge warning">Aguardando confirmação</span><dl><div><dt>Validade da cobrança</dt><dd>{new Date(pendingInvoice.due_at).toLocaleString("pt-BR")}</dd></div><div><dt>Rede</dt><dd>Solana</dd></div><div><dt>Referência</dt><dd>{pendingInvoice.reference.slice(0, 18)}…</dd></div></dl><form action={verifyLicensePurchase.bind(null, pendingInvoice.id)}><button className="button" type="submit">Verificar pagamento</button></form></article><article className="card pay-card"><p className="eyebrow">PAGAR EM USDT</p>{qr ? <Image src={qr} alt="QR code de pagamento Solana Pay" width={172} height={172} unoptimized className="qr-code" /> : <div className="qr-placeholder"><span>USDT</span></div>}<p>Após a confirmação, o lote recebe 30 dias de validade.</p><code>{BILLING_WALLET_PUBLIC_KEY}</code><button className="button secondary" type="button" onClick={copy}>{copied ? "Endereço copiado" : "Copiar endereço"}</button></article></section>}
  </>;
}
