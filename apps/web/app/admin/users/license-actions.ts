"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "../../../lib/admin/permissions";
import { createServiceClient } from "../../../lib/supabase/service";
import { logAdminAction } from "../../../lib/admin/audit";
import { refreshSubscriptionLicenses } from "../../../lib/license";

type ActionResult = { ok: boolean; message: string };

const MAX_QUANTITY = 100_000;
const MAX_YEARS = 20;

async function clientIp() {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
}

function revalidateLicensePages(userId: string, organizationId: string) {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath(`/admin/orgs/${organizationId}`);
  revalidatePath("/admin");
  revalidatePath("/billing");
  revalidatePath("/farms");
}

async function userBelongsToOrganization(service: ReturnType<typeof createServiceClient>, userId: string, organizationId: string) {
  const { data } = await service.from("memberships").select("user_id").eq("user_id", userId).eq("organization_id", organizationId).maybeSingle();
  return Boolean(data);
}

/** `expiresAt` é uma data ISO completa (o formulário converte "dias" ou "data" para ela). */
export async function grantManualLicenses(userId: string, organizationId: string, quantity: number, expiresAt: string, note: string): Promise<ActionResult> {
  const { userId: adminId } = await requireSuperAdmin();
  const service = createServiceClient();

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return { ok: false, message: `Informe uma quantidade inteira entre 1 e ${MAX_QUANTITY}.` };
  const expires = new Date(expiresAt);
  const now = new Date();
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= now.getTime()) return { ok: false, message: "A validade precisa estar no futuro." };
  if (expires.getTime() > now.getTime() + MAX_YEARS * 366 * 86400_000) return { ok: false, message: `A validade não pode passar de ${MAX_YEARS} anos.` };
  if (!(await userBelongsToOrganization(service, userId, organizationId))) return { ok: false, message: "Este usuário não pertence à organização informada." };

  const { data: batch, error } = await service.from("license_batches").insert({ organization_id: organizationId, quantity, status: "active", starts_at: now.toISOString(), expires_at: expires.toISOString() }).select("id").single();
  if (error || !batch) return { ok: false, message: error?.message ?? "Não foi possível criar o lote de licenças." };

  await refreshSubscriptionLicenses(service, organizationId);
  await logAdminAction(service, {
    adminId, targetUserId: userId, action: "license_granted", entityType: "license_batch", entityId: batch.id,
    newData: { organization_id: organizationId, quantity, starts_at: now.toISOString(), expires_at: expires.toISOString() },
    reason: note.trim() || null, ipAddress: await clientIp(),
  });
  revalidateLicensePages(userId, organizationId);
  return { ok: true, message: `${quantity} licença(s) concedida(s) até ${expires.toLocaleDateString("pt-BR")}.` };
}

/** Encerra um lote ativo na hora (status `cancelled`): as máquinas voltam a depender das demais licenças. */
export async function revokeLicenseBatch(userId: string, batchId: string, reason: string): Promise<ActionResult> {
  const { userId: adminId } = await requireSuperAdmin();
  const service = createServiceClient();

  const { data: batch } = await service.from("license_batches").select("id, organization_id, quantity, status, starts_at, expires_at").eq("id", batchId).maybeSingle();
  if (!batch) return { ok: false, message: "Lote não encontrado." };
  if (!(await userBelongsToOrganization(service, userId, batch.organization_id))) return { ok: false, message: "Este lote não pertence a uma organização deste usuário." };
  if (batch.status !== "active") return { ok: false, message: "Só lotes ativos podem ser encerrados." };

  const { error } = await service.from("license_batches").update({ status: "cancelled" }).eq("id", batch.id).eq("status", "active");
  if (error) return { ok: false, message: error.message };

  await refreshSubscriptionLicenses(service, batch.organization_id);
  await logAdminAction(service, {
    adminId, targetUserId: userId, action: "license_revoked", entityType: "license_batch", entityId: batch.id,
    oldData: { status: batch.status, quantity: batch.quantity, expires_at: batch.expires_at },
    newData: { status: "cancelled" }, reason: reason.trim() || null, ipAddress: await clientIp(),
  });
  revalidateLicensePages(userId, batch.organization_id);
  return { ok: true, message: "Lote encerrado." };
}
