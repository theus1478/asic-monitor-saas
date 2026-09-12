import { PageHeader, Shell } from "../components";
import { invoice, overview } from "../../lib/demo-data";

export default function BillingPage() {
  return <Shell><PageHeader title="Assinatura e cobrança" description="Sua licença é calculada pela quantidade de máquinas ativas." />
    <section className="invoice-grid">
      <article className="card invoice-card"><p className="eyebrow">FATURA ATUAL</p><h2>USDT {invoice.amountUsdt.toFixed(2)}</h2><p>Equivalente a US$ {invoice.amountUsd.toFixed(2)} · {overview.activeMachines} máquinas monitoradas</p><span className="badge warning">Aguardando pagamento</span>
        <dl><div><dt>Vencimento</dt><dd>{invoice.expiresAt}</dd></div><div><dt>Rede</dt><dd>Solana</dd></div><div><dt>Referência</dt><dd>{invoice.id}</dd></div></dl>
      </article>
      <article className="card pay-card"><p className="eyebrow">PAGAR EM USDT</p><div className="qr-placeholder" aria-label="QR code será gerado para a fatura"><span>USDT</span></div><p>Envie exatamente <strong>{invoice.amountUsdt.toFixed(2)} USDT</strong> pela rede Solana.</p><code>{invoice.wallet}</code><button className="button secondary">Copiar endereço</button><small>O endereço definitivo e o QR serão criados pelo servidor para cada fatura.</small></article>
    </section>
    <section className="card"><h2>Como a licença funciona</h2><div className="three-columns"><p><b>US$ 3 por máquina/mês</b><br />A cobrança considera suas máquinas monitoradas.</p><p><b>Desconto a partir de 15</b><br />As faixas progressivas serão configuradas pelo administrador.</p><p><b>Confirmação automática</b><br />A plataforma valida o pagamento na blockchain Solana.</p></div></section>
  </Shell>;
}
