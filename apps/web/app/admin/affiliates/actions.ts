"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "../../../lib/org-data";
import { createServiceClient } from "../../../lib/supabase/service";

type ActionResult = { ok: boolean; message: string };

export async function recordPayout(affiliateId: string, formData: FormData): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const commissionIds = formData.getAll("commissionIds").map(String);
  const paymentMethod = String(formData.get("paymentMethod") ?? "").trim();
  const paymentReference = String(formData.get("paymentReference") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!commissionIds.length) return { ok: false, message: "Selecione ao menos uma comissão disponível." };
  if (!paymentMethod) return { ok: false, message: "Informe o método de pagamento." };

  const service = createServiceClient();
  const { data: candidates } = await service
    .from("affiliate_commissions")
    .select("id, affiliate_id, commission_amount, status")
    .in("id", commissionIds)
    .eq("affiliate_id", affiliateId);
  const valid = (candidates ?? []).filter((c) => c.status === "available");
  if (!valid.length) return { ok: false, message: "Nenhuma das comissões selecionadas está disponível para pagamento." };

  const amount = valid.reduce((sum, c) => sum + Number(c.commission_amount), 0);

  const { data: payout, error: payoutError } = await service
    .from("affiliate_payouts")
    .insert({ affiliate_id: affiliateId, amount, payment_method: paymentMethod, payment_reference: paymentReference, notes, status: "completed", created_by: adminId })
    .select("id")
    .single();
  if (payoutError || !payout) return { ok: false, message: payoutError?.message ?? "Falha ao registrar pagamento." };

  const nowIso = new Date().toISOString();
  const { error: updateError } = await service
    .from("affiliate_commissions")
    .update({ status: "paid", paid_at: nowIso, updated_at: nowIso })
    .in("id", valid.map((c) => c.id))
    .eq("status", "available"); // reforça: só marca PAID quem ainda estava AVAILABLE no instante do update
  if (updateError) return { ok: false, message: updateError.message };

  await service.from("affiliate_payout_items").insert(valid.map((c) => ({ payout_id: payout.id, commission_id: c.id })));
  await service.from("affiliate_audit_log").insert({
    admin_id: adminId, action: "payout_create", affected_payout_id: payout.id,
    new_value: { affiliate_id: affiliateId, amount, commission_ids: valid.map((c) => c.id), payment_method: paymentMethod },
    reason: notes,
  });

  revalidatePath(`/admin/affiliates/${affiliateId}`);
  revalidatePath("/admin/affiliates");
  return { ok: true, message: `Pagamento de USDT ${amount.toFixed(2)} registrado (${valid.length} comissão${valid.length === 1 ? "" : "ões"}).` };
}

export async function cancelCommission(commissionId: string, reason: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();
  const { data: before } = await service.from("affiliate_commissions").select("*").eq("id", commissionId).maybeSingle();
  if (!before) return { ok: false, message: "Comissão não encontrada." };
  if (before.status === "paid") return { ok: false, message: "Comissão já paga — use reversão, não cancelamento." };

  const { error } = await service.from("affiliate_commissions").update({ status: "canceled", canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", commissionId);
  if (error) return { ok: false, message: error.message };

  await service.from("affiliate_audit_log").insert({ admin_id: adminId, action: "commission_cancel", affected_commission_id: commissionId, previous_value: before, new_value: { status: "canceled" }, reason: reason || null });
  revalidatePath(`/admin/affiliates/${before.affiliate_id}`);
  return { ok: true, message: "Comissão cancelada." };
}

export async function reverseCommission(commissionId: string, reason: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();
  const { data: before } = await service.from("affiliate_commissions").select("*").eq("id", commissionId).maybeSingle();
  if (!before) return { ok: false, message: "Comissão não encontrada." };

  const { error } = await service.from("affiliate_commissions").update({ status: "reversed", updated_at: new Date().toISOString() }).eq("id", commissionId);
  if (error) return { ok: false, message: error.message };

  await service.from("affiliate_audit_log").insert({ admin_id: adminId, action: "commission_reverse", affected_commission_id: commissionId, previous_value: before, new_value: { status: "reversed" }, reason: reason || null });
  revalidatePath(`/admin/affiliates/${before.affiliate_id}`);
  return { ok: true, message: "Comissão revertida." };
}

export async function updateAffiliateSettings(formData: FormData): Promise<void> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();

  const rate = Math.max(0, Math.min(100, Number(formData.get("commissionRate")) || 0));
  const holdDays = Math.max(0, Math.round(Number(formData.get("holdDays")) || 0));
  const validityDays = Math.max(0, Math.round(Number(formData.get("validityDays")) || 0));
  const enabled = formData.get("enabled") === "on";

  const { data: before } = await service.from("platform_settings").select("affiliate_program_enabled, affiliate_default_commission_rate, affiliate_hold_period_days, affiliate_referral_validity_days").eq("id", true).maybeSingle();

  const { error } = await service.from("platform_settings").update({
    affiliate_program_enabled: enabled,
    affiliate_default_commission_rate: rate,
    affiliate_hold_period_days: holdDays,
    affiliate_referral_validity_days: validityDays,
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (error) throw new Error(error.message);

  await service.from("affiliate_audit_log").insert({
    admin_id: adminId, action: "settings_update", previous_value: before,
    new_value: { affiliate_program_enabled: enabled, affiliate_default_commission_rate: rate, affiliate_hold_period_days: holdDays, affiliate_referral_validity_days: validityDays },
  });

  revalidatePath("/admin/affiliates");
}

export async function reassignReferral(referredUserId: string, newAffiliateCode: string, reason: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();
  const { data: newAffiliate } = await service.from("affiliate_profiles").select("id, user_id").ilike("affiliate_code", newAffiliateCode).maybeSingle();
  if (!newAffiliate) return { ok: false, message: "Código de afiliado não encontrado." };
  if (newAffiliate.user_id === referredUserId) return { ok: false, message: "Um usuário não pode ser afiliado de si mesmo." };

  const { data: before } = await service.from("affiliate_referrals").select("*").eq("referred_user_id", referredUserId).maybeSingle();
  if (!before) return { ok: false, message: "Este usuário não tem indicação registrada." };

  const { error } = await service.from("affiliate_referrals").update({ affiliate_id: newAffiliate.id, referral_code: newAffiliateCode.toUpperCase() }).eq("referred_user_id", referredUserId);
  if (error) return { ok: false, message: error.message };

  await service.from("affiliate_audit_log").insert({ admin_id: adminId, action: "referral_reassign", affected_user_id: referredUserId, previous_value: before, new_value: { affiliate_id: newAffiliate.id }, reason: reason || null });
  revalidatePath(`/admin/affiliates/${before.affiliate_id}`);
  revalidatePath(`/admin/affiliates/${newAffiliate.id}`);
  return { ok: true, message: "Indicação reatribuída." };
}
