"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOrganizationId } from "../../lib/org-data";
import { createServiceClient } from "../../lib/supabase/service";
import { BILLING_WALLET_PUBLIC_KEY, monthlyPriceCents, SOLANA_USDT_MINT } from "../../lib/pricing";
import { recordAffiliateCommissionForInvoice } from "../../lib/affiliate";

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
  const { data: invoice, error } = await supabase.from("invoices").insert({ organization_id: organizationId, subscription_id: subscription.id, reference, amount_usdt: monthlyPriceCents(quantity) / 100, wallet_address: BILLING_WALLET_PUBLIC_KEY, network: "solana", status: "pending", due_at: new Date(Date.now() + 30 * 60_000).toISOString() }).select("id").single();
  if (error || !invoice) redirect(`/billing?error=${encodeURIComponent(error?.message ?? "Não foi possível gerar a cobrança.")}`);
  const batch = await supabase.from("license_batches").insert({ organization_id: organizationId, invoice_id: invoice.id, quantity, status: "pending" });
  if (batch.error) redirect(`/billing?error=${encodeURIComponent(batch.error.message)}`);
  redirect(`/billing?invoice=${invoice.id}`);
}

type RpcTokenBalance = { mint?: string; owner?: string; uiTokenAmount?: { amount?: string; decimals?: number } };
type ParsedTransaction = {
  meta?: { err?: unknown; preTokenBalances?: RpcTokenBalance[]; postTokenBalances?: RpcTokenBalance[] };
  transaction?: { message?: { instructions?: Array<{ program?: string; parsed?: unknown }> } };
};

function tokenTotal(balances: RpcTokenBalance[] | undefined, owner: string) {
  return (balances ?? []).filter((item) => item.owner === owner && item.mint === SOLANA_USDT_MINT).reduce((sum, item) => {
    const raw = Number(item.uiTokenAmount?.amount ?? 0), decimals = item.uiTokenAmount?.decimals ?? 6;
    return sum + raw / 10 ** decimals;
  }, 0);
}

function containsReference(transaction: ParsedTransaction, reference: string) {
  return (transaction.transaction?.message?.instructions ?? []).some((instruction) =>
    instruction.program === "spl-memo" && JSON.stringify(instruction.parsed ?? "").includes(reference));
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
  });
  if (!response.ok) throw new Error(`RPC Solana indisponível (${response.status}).`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? "Falha ao consultar a rede Solana.");
  return payload.result;
}

export async function verifyLicensePurchase(invoiceId: string) {
  const { supabase, organizationId } = await getOrganizationId();
  if (!organizationId) redirect("/sign-in");
  const { data: invoice } = await supabase.from("invoices").select("id, reference, amount_usdt, wallet_address, status, due_at").eq("id", invoiceId).eq("organization_id", organizationId).maybeSingle();
  if (!invoice) redirect("/billing?error=Cobrança não encontrada.");
  if (invoice.status === "paid") redirect("/billing");
  if (new Date(invoice.due_at).getTime() < Date.now()) redirect(`/billing?invoice=${invoice.id}&error=${encodeURIComponent("A cobrança expirou. Gere uma nova cobrança.")}`);

  try {
    const tokenAccounts = await rpc("getTokenAccountsByOwner", [invoice.wallet_address, { mint: SOLANA_USDT_MINT }, { encoding: "jsonParsed" }]);
    const addresses = (tokenAccounts?.value ?? []).map((entry: { pubkey: string }) => entry.pubkey);
    const signatures = (await Promise.all(addresses.map(async (address: string) => rpc("getSignaturesForAddress", [address, { limit: 60 }])))).flat();
    const unique = [...new Map(signatures.filter((item: { err?: unknown }) => !item.err).map((item: { signature: string }) => [item.signature, item])).values()] as Array<{ signature: string }>;
    let match: { signature: string; transaction: ParsedTransaction } | null = null;
    for (const item of unique.slice(0, 100)) {
      const transaction = await rpc("getTransaction", [item.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]) as ParsedTransaction | null;
      if (!transaction || transaction.meta?.err || !containsReference(transaction, invoice.reference)) continue;
      const received = tokenTotal(transaction.meta?.postTokenBalances, invoice.wallet_address) - tokenTotal(transaction.meta?.preTokenBalances, invoice.wallet_address);
      if (received + 0.000001 >= Number(invoice.amount_usdt)) { match = { signature: item.signature, transaction }; break; }
    }
    if (!match) throw new Error("Pagamento ainda não localizado. Aguarde a confirmação da rede e tente novamente.");

    const service = createServiceClient();
    const paidAt = new Date(), expiresAt = new Date(paidAt.getTime() + 30 * 86400_000);
    const { error: invoiceError } = await service.from("invoices").update({ status: "paid", paid_at: paidAt.toISOString(), transaction_signature: match.signature }).eq("id", invoice.id).eq("status", "pending");
    if (invoiceError) throw invoiceError;
    const { error: batchError } = await service.from("license_batches").update({ status: "active", starts_at: paidAt.toISOString(), expires_at: expiresAt.toISOString() }).eq("invoice_id", invoice.id).eq("status", "pending");
    if (batchError) throw batchError;
    const { data: activeBatches } = await service.from("license_batches").select("quantity, expires_at").eq("organization_id", organizationId).eq("status", "active").gt("expires_at", paidAt.toISOString());
    const licensedMachines = (activeBatches ?? []).reduce((sum, batch) => sum + Number(batch.quantity), 0);
    const latestExpiry = (activeBatches ?? []).reduce<string | null>((latest, batch) => !latest || batch.expires_at > latest ? batch.expires_at : latest, null);
    await service.from("subscriptions").update({ status: "active", licensed_machines: licensedMachines, current_period_end: latestExpiry }).eq("organization_id", organizationId);
    await recordAffiliateCommissionForInvoice(service, invoice.id);
    revalidatePath("/billing"); revalidatePath("/farms");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível consultar a rede Solana.";
    redirect(`/billing?invoice=${invoice.id}&error=${encodeURIComponent(message)}`);
  }
  redirect("/billing?payment=confirmed");
}
