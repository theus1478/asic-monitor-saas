"use server";

import { randomInt, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getOrganizationId } from "../../lib/org-data";
import { createServiceClient } from "../../lib/supabase/service";
import { monthlyPriceCents } from "../../lib/pricing";
import { createBitcartInvoice, getBitcartInvoice, isBitcartInvoicePaid } from "../../lib/bitcart";
import { activateLicenseForInvoice } from "../../lib/billing";

const INVOICE_VALIDITY_MINUTES = 30;

// A carteira do BitCart é um único endereço, então cada fatura em aberto
// precisa de um valor exato diferente (até +0,000999 USDT) para o pagamento
// ser atribuído ao cliente certo. Precisa do service client: a RLS esconde as
// faturas de outras organizações.
async function pickUniqueAmount(service: ReturnType<typeof createServiceClient>, baseAmount: number) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const amount = Number((baseAmount + randomInt(1, 1000) / 1_000_000).toFixed(6));
    const { count } = await service.from("invoices").select("id", { count: "exact", head: true }).eq("status", "pending").gt("due_at", new Date().toISOString()).eq("amount_usdt", amount);
    if (!count) return amount;
  }
  throw new Error("Não foi possível gerar um valor único para a cobrança. Tente novamente.");
}

export async function createLicensePurchase(formData: FormData) {
  const quantity = Math.max(1, Math.min(9999, Math.round(Number(formData.get("quantity")) || 0)));
  const { supabase, organizationId } = await getOrganizationId();
  if (!organizationId) redirect("/sign-in");
  let { data: subscription } = await supabase.from("subscriptions").select("id").eq("organization_id", organizationId).maybeSingle();
  if (!subscription) {
    const result = await supabase.from("subscriptions").insert({ organization_id: organizationId, licensed_machines: 0, status: "trial" }).select("id").single();
    if (result.error) redirect(`/billing?error=${encodeURIComponent(result.error.message)}`);
    subscription = result.data;
  }

  const reference = `LIC-${randomUUID()}`;
  let charge: { id: string; address: string; amountUsdt: number };
  try {
    const service = createServiceClient();
    const amountUsdt = await pickUniqueAmount(service, monthlyPriceCents(quantity) / 100);
    // Quem chama o webhook é o container do BitCart, na mesma VPS — em produção
    // BITCART_WEBHOOK_BASE_URL aponta para o endereço interno do app (evita
    // depender do DNS público / hairpin da própria VPS).
    const webhookBase = process.env.BITCART_WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://monitorasic.club";
    const notificationUrl = `${webhookBase}/api/webhooks/bitcart?secret=${encodeURIComponent(process.env.BITCART_WEBHOOK_SECRET ?? "")}`;
    charge = await createBitcartInvoice({ orderId: reference, amountUsdt, expirationMinutes: INVOICE_VALIDITY_MINUTES, notificationUrl });
  } catch (error) {
    redirect(`/billing?error=${encodeURIComponent(error instanceof Error ? error.message : "Não foi possível gerar a cobrança.")}`);
  }

  const { data: invoice, error } = await supabase.from("invoices").insert({ organization_id: organizationId, subscription_id: subscription.id, reference, amount_usdt: charge.amountUsdt, wallet_address: charge.address, network: "bsc", bitcart_invoice_id: charge.id, status: "pending", due_at: new Date(Date.now() + INVOICE_VALIDITY_MINUTES * 60_000).toISOString() }).select("id").single();
  if (error || !invoice) redirect(`/billing?error=${encodeURIComponent(error?.message ?? "Não foi possível gerar a cobrança.")}`);
  const batch = await supabase.from("license_batches").insert({ organization_id: organizationId, invoice_id: invoice.id, quantity, status: "pending" });
  if (batch.error) redirect(`/billing?error=${encodeURIComponent(batch.error.message)}`);
  redirect(`/billing?invoice=${invoice.id}`);
}

// Fallback manual: a confirmação normal chega sozinha pelo webhook do BitCart
// (app/api/webhooks/bitcart), este botão só consulta o BitCart na hora.
export async function verifyLicensePurchase(invoiceId: string) {
  const { supabase, organizationId } = await getOrganizationId();
  if (!organizationId) redirect("/sign-in");
  const { data: invoice } = await supabase.from("invoices").select("id, amount_usdt, status, due_at, bitcart_invoice_id").eq("id", invoiceId).eq("organization_id", organizationId).maybeSingle();
  if (!invoice) redirect("/billing?error=Cobrança não encontrada.");
  if (invoice.status === "paid") redirect("/billing");
  if (!invoice.bitcart_invoice_id) redirect(`/billing?error=${encodeURIComponent("Cobrança antiga (rede Solana, descontinuada). Gere uma nova cobrança.")}`);

  let message: string | null = null;
  try {
    const bitcartInvoice = await getBitcartInvoice(invoice.bitcart_invoice_id);
    if (isBitcartInvoicePaid(bitcartInvoice, Number(invoice.amount_usdt))) {
      await activateLicenseForInvoice(createServiceClient(), invoice.id, bitcartInvoice.tx_hashes?.[0]);
    } else if (new Date(invoice.due_at).getTime() < Date.now()) {
      message = "A cobrança expirou. Gere uma nova cobrança.";
    } else {
      message = "Pagamento ainda não confirmado. Confira se enviou o valor exato (com as casas decimais) e tente novamente em alguns minutos.";
    }
  } catch (error) {
    message = error instanceof Error ? error.message : "Não foi possível consultar o BitCart.";
  }
  if (message) redirect(`/billing?invoice=${invoice.id}&error=${encodeURIComponent(message)}`);
  redirect("/billing?payment=confirmed");
}
