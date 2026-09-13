"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { BILLING_WALLET_PUBLIC_KEY, buildSolanaPayUri, monthlyPriceCents } from "../../lib/pricing";

const REFERENCE = "INV-" + new Date().toISOString().slice(0, 7);

function nextCycleDate() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function BillingCalculator({ initialMachineCount }: { initialMachineCount: number }) {
  const [machineCount, setMachineCount] = useState(initialMachineCount);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amountUsdt = useMemo(() => monthlyPriceCents(machineCount) / 100, [machineCount]);
  const solanaPayUri = useMemo(() => buildSolanaPayUri(amountUsdt, REFERENCE), [amountUsdt]);
  const dueDate = useMemo(() => nextCycleDate(), []);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(solanaPayUri, { margin: 1, width: 260, color: { dark: "#08110d", light: "#d9f8ed" } })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [solanaPayUri]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(BILLING_WALLET_PUBLIC_KEY);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // navegador sem permissão de clipboard; endereço já está visível para cópia manual.
    }
  }

  function handleMachineCountChange(value: string) {
    const parsed = Math.max(0, Math.min(9999, Math.round(Number(value) || 0)));
    setMachineCount(parsed);
  }

  return <>
    <section className="card calculator-card">
      <p className="eyebrow">CALCULADORA DE LICENÇA</p>
      <div className="calculator-row">
        <label className="calculator-input">
          Quantidade de máquinas
          <input
            type="number"
            min={0}
            max={9999}
            value={machineCount}
            onChange={(event) => handleMachineCountChange(event.target.value)}
          />
        </label>
        <div className="calculator-result">
          <span className="muted">Valor mensal estimado</span>
          <strong>USDT {amountUsdt.toFixed(2)}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Faixa (máquinas)</th><th>Preço por máquina</th></tr></thead>
          <tbody>
            <tr><td>1 – 14</td><td>US$ 3,00</td></tr>
            <tr><td>15 – 49</td><td>US$ 2,70</td></tr>
            <tr><td>50 – 99</td><td>US$ 2,40</td></tr>
            <tr><td>100+</td><td>US$ 2,10</td></tr>
          </tbody>
        </table>
      </div>
      <small className="muted">Preço graduado: cada máquina paga o valor da faixa em que se encaixa. Faixas configuráveis pelo administrador da plataforma.</small>
    </section>
    <section className="invoice-grid">
      <article className="card invoice-card">
        <p className="eyebrow">FATURA CALCULADA</p>
        <h2>USDT {amountUsdt.toFixed(2)}</h2>
        <p>Equivalente a US$ {amountUsdt.toFixed(2)} · {machineCount} máquina{machineCount === 1 ? "" : "s"}</p>
        <span className="badge warning">Aguardando pagamento</span>
        <dl>
          <div><dt>Próximo ciclo</dt><dd>{dueDate}</dd></div>
          <div><dt>Rede</dt><dd>Solana</dd></div>
          <div><dt>Referência</dt><dd>{REFERENCE}</dd></div>
        </dl>
      </article>
      <article className="card pay-card">
        <p className="eyebrow">PAGAR EM USDT</p>
        {qrDataUrl
          ? <img src={qrDataUrl} alt="QR code de pagamento Solana Pay" width={160} height={160} className="qr-code" />
          : <div className="qr-placeholder" aria-label="Gerando QR code"><span>USDT</span></div>}
        <p>Envie exatamente <strong>{amountUsdt.toFixed(2)} USDT</strong> pela rede Solana.</p>
        <code>{BILLING_WALLET_PUBLIC_KEY}</code>
        <button className="button secondary" type="button" onClick={copyAddress}>{copied ? "Copiado!" : "Copiar endereço"}</button>
        <small>Escaneie o QR com uma carteira compatível com Solana Pay ou copie o endereço manualmente.</small>
      </article>
    </section>
  </>;
}
