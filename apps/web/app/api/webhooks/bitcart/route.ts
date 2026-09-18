import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/service";
import { getBitcartInvoice, isBitcartInvoicePaid, isValidWebhookSecret } from "../../../../lib/bitcart";
import { activateLicenseForInvoice } from "../../../../lib/billing";

export const runtime = "nodejs";

// O BitCart chama esta URL a cada mudança de status da fatura (a URL vai na
// criação da invoice, com o segredo na query). O corpo recebido NÃO é
// confiável: usamos só o id dele e confirmamos o status direto na API do
// BitCart antes de liberar qualquer licença.
export async function POST(request: Request) {
  if (!isValidWebhookSecret(new URL(request.url).searchParams.get("secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as { id?: string } | null;
  const bitcartInvoiceId = typeof body?.id === "string" ? body.id : null;
  if (!bitcartInvoiceId) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const service = createServiceClient();
  const { data: invoice } = await service.from("invoices").select("id, amount_usdt, status").eq("bitcart_invoice_id", bitcartInvoiceId).maybeSingle();
  if (!invoice) return NextResponse.json({ ok: true, ignored: "unknown invoice" });
  if (invoice.status === "paid") return NextResponse.json({ ok: true, alreadyPaid: true });

  try {
    const bitcartInvoice = await getBitcartInvoice(bitcartInvoiceId);
    if (!isBitcartInvoicePaid(bitcartInvoice, Number(invoice.amount_usdt))) return NextResponse.json({ ok: true, paid: false, status: bitcartInvoice.status });
    const result = await activateLicenseForInvoice(service, invoice.id, bitcartInvoice.tx_hashes?.[0]);
    return NextResponse.json({ ok: true, paid: true, activated: result.activated });
  } catch (error) {
    console.error("Falha ao processar webhook do BitCart", bitcartInvoiceId, error);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
