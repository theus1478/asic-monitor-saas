import { createHash, timingSafeEqual } from "node:crypto";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return value;
}

type BitcartPayment = { payment_address?: string; amount?: string };

export type BitcartInvoice = {
  id: string;
  status: string;
  exception_status?: string;
  price?: string;
  sent_amount?: number;
  tx_hashes?: string[];
  payments?: BitcartPayment[];
};

async function bitcartFetch(path: string, init?: RequestInit): Promise<BitcartInvoice> {
  const response = await fetch(`${requireEnv("BITCART_API_URL")}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${requireEnv("BITCART_API_TOKEN")}` },
  });
  if (!response.ok) throw new Error(`BitCart indisponível (${response.status}).`);
  return response.json();
}

/**
 * A carteira do BitCart é watch-only (um único endereço BSC do dono), então
 * o que diferencia uma fatura da outra é o valor exato em USDT — quem chama
 * precisa garantir que `amountUsdt` é único entre as faturas em aberto.
 */
export async function createBitcartInvoice(input: { orderId: string; amountUsdt: number; expirationMinutes: number; notificationUrl: string }) {
  const invoice = await bitcartFetch("/invoices", {
    method: "POST",
    body: JSON.stringify({
      price: input.amountUsdt.toFixed(6),
      currency: "USDT",
      store_id: requireEnv("BITCART_STORE_ID"),
      order_id: input.orderId,
      expiration: input.expirationMinutes,
      notification_url: input.notificationUrl,
    }),
  });
  const payment = invoice.payments?.[0];
  if (!invoice.id || !payment?.payment_address) throw new Error("O BitCart não devolveu um endereço de pagamento.");
  return { id: invoice.id, address: payment.payment_address, amountUsdt: Number(Number(payment.amount ?? input.amountUsdt).toFixed(6)) };
}

export function getBitcartInvoice(bitcartInvoiceId: string) {
  return bitcartFetch(`/invoices/${encodeURIComponent(bitcartInvoiceId)}`);
}

/** Só `confirmed`/`complete` sem exceção (ou com pagamento a maior) libera a licença. */
export function isBitcartInvoicePaid(invoice: BitcartInvoice, expectedAmountUsdt: number) {
  if (invoice.status !== "confirmed" && invoice.status !== "complete") return false;
  if (invoice.exception_status && invoice.exception_status !== "none" && invoice.exception_status !== "paid_over") return false;
  return (invoice.sent_amount ?? 0) + 0.000001 >= expectedAmountUsdt;
}

export function isValidWebhookSecret(provided: string | null) {
  const expected = process.env.BITCART_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
