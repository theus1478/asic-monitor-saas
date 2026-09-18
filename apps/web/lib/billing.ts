import { revalidatePath } from "next/cache";
import { createServiceClient } from "./supabase/service";
import { recordAffiliateCommissionForInvoice } from "./affiliate";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Marca a fatura como paga e ativa o lote de licenças (30 dias). Chamada pelo
 * webhook do BitCart e pelo botão manual "Verificar pagamento" — o
 * `.eq("status", "pending")` garante que só a primeira chamada ativa.
 */
export async function activateLicenseForInvoice(service: ServiceClient, invoiceId: string, txHash?: string | null) {
  const { data: invoice } = await service.from("invoices").select("id, organization_id").eq("id", invoiceId).maybeSingle();
  if (!invoice) throw new Error("Cobrança não encontrada.");

  const paidAt = new Date(), expiresAt = new Date(paidAt.getTime() + 30 * 86400_000);
  const { data: updated, error: invoiceError } = await service.from("invoices").update({ status: "paid", paid_at: paidAt.toISOString(), transaction_signature: txHash ?? null }).eq("id", invoice.id).eq("status", "pending").select("id");
  if (invoiceError) throw invoiceError;
  if (!updated?.length) return { activated: false };

  const { error: batchError } = await service.from("license_batches").update({ status: "active", starts_at: paidAt.toISOString(), expires_at: expiresAt.toISOString() }).eq("invoice_id", invoice.id).eq("status", "pending");
  if (batchError) throw batchError;
  const { data: activeBatches } = await service.from("license_batches").select("quantity, expires_at").eq("organization_id", invoice.organization_id).eq("status", "active").gt("expires_at", paidAt.toISOString());
  const licensedMachines = (activeBatches ?? []).reduce((sum, batch) => sum + Number(batch.quantity), 0);
  const latestExpiry = (activeBatches ?? []).reduce<string | null>((latest, batch) => !latest || batch.expires_at > latest ? batch.expires_at : latest, null);
  await service.from("subscriptions").update({ status: "active", licensed_machines: licensedMachines, current_period_end: latestExpiry }).eq("organization_id", invoice.organization_id);
  await recordAffiliateCommissionForInvoice(service, invoice.id);
  revalidatePath("/billing"); revalidatePath("/farms");
  return { activated: true };
}
