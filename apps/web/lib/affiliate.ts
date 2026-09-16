import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/service";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I, evita confusão ao digitar

function randomCode(length = 7) {
  let code = "";
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

type PlatformAffiliateSettings = {
  affiliate_program_enabled: boolean;
  affiliate_default_commission_rate: number;
  affiliate_hold_period_days: number;
  affiliate_referral_validity_days: number;
};

export async function getAffiliateSettings(service: SupabaseClient): Promise<PlatformAffiliateSettings> {
  const { data } = await service
    .from("platform_settings")
    .select("affiliate_program_enabled, affiliate_default_commission_rate, affiliate_hold_period_days, affiliate_referral_validity_days")
    .eq("id", true)
    .maybeSingle();
  return {
    affiliate_program_enabled: data?.affiliate_program_enabled ?? true,
    affiliate_default_commission_rate: Number(data?.affiliate_default_commission_rate ?? 10),
    affiliate_hold_period_days: Number(data?.affiliate_hold_period_days ?? 30),
    affiliate_referral_validity_days: Number(data?.affiliate_referral_validity_days ?? 30),
  };
}

/** Busca o perfil de afiliado do usuário logado, criando um na primeira vez que ele acessa o painel. */
export async function getOrCreateAffiliateProfile(supabase: SupabaseClient, userId: string) {
  const { data: existing } = await supabase.from("affiliate_profiles").select("id, affiliate_code, commission_rate, status, created_at").eq("user_id", userId).maybeSingle();
  if (existing) return existing;

  const service = createServiceClient();
  const settings = await getAffiliateSettings(service);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode();
    const { data, error } = await supabase
      .from("affiliate_profiles")
      .insert({ user_id: userId, affiliate_code: code, commission_rate: settings.affiliate_default_commission_rate })
      .select("id, affiliate_code, commission_rate, status, created_at")
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw new Error(error.message); // só tenta de novo em colisão de código único
  }
  throw new Error("Não foi possível gerar um código de afiliado único. Tente novamente.");
}

/**
 * Gera a comissão de uma fatura paga, se o dono da organização compradora
 * tiver sido indicado por um afiliado. Idempotente: purchase_id é UNIQUE em
 * affiliate_commissions, então uma segunda chamada para a mesma fatura só
 * colide e não faz nada (nunca duplica comissão).
 */
export async function recordAffiliateCommissionForInvoice(service: SupabaseClient, invoiceId: string) {
  const { data: invoice } = await service.from("invoices").select("id, organization_id, amount_usdt, paid_at").eq("id", invoiceId).maybeSingle();
  if (!invoice || !invoice.paid_at) return;

  const settings = await getAffiliateSettings(service);
  if (!settings.affiliate_program_enabled) return;

  const { data: batch } = await service.from("license_batches").select("quantity").eq("invoice_id", invoiceId).maybeSingle();
  const licenseQuantity = batch?.quantity ?? 1;

  const { data: owner } = await service.from("memberships").select("user_id").eq("organization_id", invoice.organization_id).eq("role", "owner").maybeSingle();
  if (!owner) return;

  const { data: referral } = await service.from("affiliate_referrals").select("affiliate_id").eq("referred_user_id", owner.user_id).maybeSingle();
  if (!referral) return;

  const { data: affiliate } = await service.from("affiliate_profiles").select("id, user_id, commission_rate, status").eq("id", referral.affiliate_id).maybeSingle();
  if (!affiliate || affiliate.status !== "active" || affiliate.user_id === owner.user_id) return;

  const purchaseAmount = Number(invoice.amount_usdt);
  const commissionAmount = Math.round(purchaseAmount * Number(affiliate.commission_rate) * 100) / 10000; // 2 casas, sem float acumulando erro perceptível
  const purchaseDate = new Date(invoice.paid_at);
  const availableAt = new Date(purchaseDate.getTime() + settings.affiliate_hold_period_days * 86400_000);

  await service.from("affiliate_commissions").insert({
    affiliate_id: affiliate.id,
    referred_user_id: owner.user_id,
    purchase_id: invoice.id,
    license_quantity: licenseQuantity,
    purchase_amount: purchaseAmount,
    commission_rate: affiliate.commission_rate,
    commission_amount: commissionAmount,
    status: "pending",
    purchase_date: purchaseDate.toISOString(),
    available_at: availableAt.toISOString(),
  }); // erro de unique violation (mesma purchase_id) é esperado em corrida e ignorado por design
}

/** Nome parcialmente anonimizado pra exibir no painel do afiliado — evita expor dado pessoal desnecessário do indicado. */
export function maskReferredName(fullName: string | null, fallbackId: string) {
  const name = (fullName ?? "").trim();
  if (!name) return `Cliente #${fallbackId.slice(0, 6)}`;
  const parts = name.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : "";
  return `${first}${lastInitial}`;
}

export type ReferralRow = {
  referredUserId: string;
  name: string;
  referredAt: string;
  totalLicenses: number;
  totalPurchases: number;
  totalVolume: number;
  totalCommission: number;
  pendingCommission: number;
  availableCommission: number;
  nextReleaseAt: string | null;
  hasPurchased: boolean;
};

export type CommissionRow = {
  id: string;
  referredUserId: string;
  referredName: string;
  purchaseId: string;
  licenseQuantity: number;
  purchaseAmount: number;
  commissionRate: number;
  commissionAmount: number;
  purchaseDate: string;
  availableAt: string;
  status: string;
};

/** Monta as linhas da tabela de indicações a partir das comissões já geradas para cada indicado. */
export function buildReferralRows(
  referrals: { referred_user_id: string; referred_at: string }[],
  commissions: { referred_user_id: string; license_quantity: number; purchase_amount: number | string; commission_amount: number | string; status: string; available_at: string }[],
  nameByUserId: Map<string, string>,
): ReferralRow[] {
  return referrals.map((referral) => {
    const own = commissions.filter((c) => c.referred_user_id === referral.referred_user_id);
    const activeOwn = own.filter((c) => c.status !== "canceled" && c.status !== "reversed");
    const pending = own.filter((c) => c.status === "pending");
    const nextReleaseAt = pending.length
      ? pending.reduce<string | null>((min, c) => !min || c.available_at < min ? c.available_at : min, null)
      : null;
    return {
      referredUserId: referral.referred_user_id,
      name: nameByUserId.get(referral.referred_user_id) ?? `Cliente #${referral.referred_user_id.slice(0, 6)}`,
      referredAt: referral.referred_at,
      totalLicenses: activeOwn.reduce((sum, c) => sum + c.license_quantity, 0),
      totalPurchases: activeOwn.length,
      totalVolume: activeOwn.reduce((sum, c) => sum + Number(c.purchase_amount), 0),
      totalCommission: activeOwn.reduce((sum, c) => sum + Number(c.commission_amount), 0),
      pendingCommission: pending.reduce((sum, c) => sum + Number(c.commission_amount), 0),
      availableCommission: own.filter((c) => c.status === "available").reduce((sum, c) => sum + Number(c.commission_amount), 0),
      nextReleaseAt,
      hasPurchased: activeOwn.length > 0,
    };
  });
}

/** Libera comissões PENDING cujo prazo de carência já passou. Chamado pelo cron e, como reforço, ao abrir os painéis. */
export async function releaseMaturedCommissions(service: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const { data } = await service
    .from("affiliate_commissions")
    .update({ status: "available", updated_at: nowIso })
    .eq("status", "pending")
    .lte("available_at", nowIso)
    .select("id");
  return data?.length ?? 0;
}
