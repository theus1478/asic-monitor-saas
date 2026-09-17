"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "../../../lib/org-data";
import { requireSuperAdmin, assertNotLastSuperAdmin, isSuperAdmin } from "../../../lib/admin/permissions";
import { createServiceClient } from "../../../lib/supabase/service";
import { logAdminAction } from "../../../lib/admin/audit";

type ActionResult = { ok: boolean; message: string };

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
const RESERVED_USERNAMES = new Set(["admin", "administrator", "api", "root", "support", "null", "undefined", "superadmin", "super_admin", "moderator", "system", "asicmonitor"]);
const BAN_FOREVER = "876000h"; // ~100 anos — o GoTrue não aceita "infinite" direto, mas aceita durações bem longas.

async function clientIp() {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
}

export async function updateUserProfile(userId: string, formData: FormData): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();

  const { data: before } = await service.from("profiles").select("full_name, phone, company, job_title, timezone, country, admin_notes").eq("id", userId).maybeSingle();
  if (!before) return { ok: false, message: "Usuário não encontrado." };

  const patch = {
    full_name: String(formData.get("fullName") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    company: String(formData.get("company") ?? "").trim() || null,
    job_title: String(formData.get("jobTitle") ?? "").trim() || null,
    timezone: String(formData.get("timezone") ?? "").trim() || null,
    country: String(formData.get("country") ?? "").trim() || null,
    admin_notes: String(formData.get("adminNotes") ?? "").trim() || null,
  };

  const { error } = await service.from("profiles").update(patch).eq("id", userId);
  if (error) return { ok: false, message: error.message };

  await logAdminAction(service, { adminId, targetUserId: userId, action: "profile_update", oldData: before, newData: patch, ipAddress: await clientIp() });
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "Perfil atualizado." };
}

export async function changeUserEmail(userId: string, newEmail: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "E-mail inválido." };

  const service = createServiceClient();
  const { data: current } = await service.auth.admin.getUserById(userId);
  if (!current.user) return { ok: false, message: "Usuário não encontrado." };
  const oldEmail = current.user.email ?? null;
  if (oldEmail === email) return { ok: false, message: "O novo e-mail é igual ao atual." };

  const { data: existing } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (existing.users.some((u) => u.id !== userId && u.email?.toLowerCase() === email)) {
    return { ok: false, message: "Este e-mail já está em uso por outra conta." };
  }

  const { error } = await service.auth.admin.updateUserById(userId, { email, email_confirm: true });
  if (error) return { ok: false, message: error.message };

  await logAdminAction(service, { adminId, targetUserId: userId, action: "email_change", oldData: { email: oldEmail }, newData: { email }, ipAddress: await clientIp() });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  return { ok: true, message: `E-mail alterado para ${email}.` };
}

export async function changeUsername(userId: string, newUsername: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const username = newUsername.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return { ok: false, message: "Username inválido — use 3 a 30 caracteres: letras minúsculas, números, ponto ou underline." };
  if (RESERVED_USERNAMES.has(username)) return { ok: false, message: "Este username é reservado." };

  const service = createServiceClient();
  const { data: before } = await service.from("profiles").select("username").eq("id", userId).maybeSingle();
  if (!before) return { ok: false, message: "Usuário não encontrado." };

  const { error } = await service.from("profiles").update({ username }).eq("id", userId);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Este username já está em uso." };
    return { ok: false, message: error.message };
  }

  await logAdminAction(service, { adminId, targetUserId: userId, action: "username_change", oldData: { username: before.username }, newData: { username }, ipAddress: await clientIp() });
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: `Username alterado para @${username}.` };
}

/** Envia o e-mail padrão de redefinição de senha (mesmo fluxo de user-actions.ts), registrando a ação no histórico do usuário. */
export async function resetUserPassword(userId: string, email: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://asic-monitor-saas-vercel.vercel.app";
  const { error } = await service.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/sign-in` });
  if (error) return { ok: false, message: error.message };

  await logAdminAction(service, { adminId, targetUserId: userId, action: "password_reset_link_sent", ipAddress: await clientIp() });
  return { ok: true, message: `E-mail de redefinição enviado para ${email}.` };
}

export async function setTemporaryPassword(userId: string, tempPassword: string, forceChange: boolean): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  if (tempPassword.length < 8) return { ok: false, message: "A senha temporária precisa ter ao menos 8 caracteres." };

  const service = createServiceClient();
  const { data: current } = await service.auth.admin.getUserById(userId);
  if (!current.user) return { ok: false, message: "Usuário não encontrado." };

  const { error } = await service.auth.admin.updateUserById(userId, {
    password: tempPassword,
    user_metadata: { ...current.user.user_metadata, force_password_change: forceChange },
  });
  if (error) return { ok: false, message: error.message };

  // Nunca grava a senha no log — só o fato de que uma foi definida.
  await logAdminAction(service, { adminId, targetUserId: userId, action: "password_set_temporary", newData: { force_password_change: forceChange }, ipAddress: await clientIp() });
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "Senha temporária definida." };
}

export async function updateAccountStatus(userId: string, status: "active" | "inactive" | "suspended" | "blocked", reason: string): Promise<ActionResult> {
  const { userId: adminId } = await requirePlatformAdmin();
  if (userId === adminId) return { ok: false, message: "Você não pode alterar o status da própria conta." };

  const service = createServiceClient();
  const { data: before } = await service.from("profiles").select("account_status, status_reason").eq("id", userId).maybeSingle();
  if (!before) return { ok: false, message: "Usuário não encontrado." };

  const { error } = await service.from("profiles").update({
    account_status: status,
    status_reason: reason.trim() || null,
    status_changed_at: new Date().toISOString(),
    status_changed_by: adminId,
  }).eq("id", userId);
  if (error) return { ok: false, message: error.message };

  // suspenso/bloqueado usa o ban nativo do GoTrue — impede login de verdade,
  // não só marca um campo decorativo. Reativar/inativar libera o ban.
  const banDuration = status === "suspended" || status === "blocked" ? BAN_FOREVER : "none";
  const { error: banError } = await service.auth.admin.updateUserById(userId, { ban_duration: banDuration });
  if (banError) return { ok: false, message: banError.message };

  await logAdminAction(service, {
    adminId, targetUserId: userId, action: "account_status_change",
    oldData: before, newData: { account_status: status, status_reason: reason || null }, reason: reason || null, ipAddress: await clientIp(),
  });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  return { ok: true, message: `Conta marcada como ${status}.` };
}

export async function updatePlatformRole(userId: string, role: "super_admin" | "admin" | null): Promise<ActionResult> {
  const { userId: adminId } = await requireSuperAdmin();
  if (userId === adminId) return { ok: false, message: "Você não pode alterar sua própria permissão de administrador." };

  const service = createServiceClient();
  const { data: before } = await service.from("profiles").select("platform_role").eq("id", userId).maybeSingle();
  if (!before) return { ok: false, message: "Usuário não encontrado." };

  if (before.platform_role === "super_admin" && role !== "super_admin") {
    try {
      await assertNotLastSuperAdmin(service, userId);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Falha ao validar." };
    }
  }

  const { error } = await service.from("profiles").update({ platform_role: role }).eq("id", userId);
  if (error) return { ok: false, message: error.message };

  await logAdminAction(service, { adminId, targetUserId: userId, action: "platform_role_change", oldData: before, newData: { platform_role: role }, ipAddress: await clientIp() });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  return { ok: true, message: role ? `Promovido a ${role === "super_admin" ? "Super Admin" : "Admin"}.` : "Acesso de admin removido." };
}

export async function createUser(formData: FormData): Promise<void> {
  const { userId: adminId } = await requirePlatformAdmin();
  const service = createServiceClient();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim() || null;
  const username = String(formData.get("username") ?? "").trim().toLowerCase() || null;
  const sendInvite = formData.get("sendInvite") === "on";
  const tempPassword = String(formData.get("tempPassword") ?? "");
  const roleRaw = String(formData.get("platformRole") ?? "");
  const requestedRole = roleRaw === "admin" || roleRaw === "super_admin" ? (roleRaw as "admin" | "super_admin") : null;

  if (!email) throw new Error("Informe o e-mail.");
  if (!sendInvite && tempPassword.length < 8) throw new Error("Informe uma senha temporária com ao menos 8 caracteres, ou marque \"Enviar convite por e-mail\".");
  if (username && !USERNAME_RE.test(username)) throw new Error("Username inválido — use 3 a 30 caracteres: letras minúsculas, números, ponto ou underline.");
  if (username && RESERVED_USERNAMES.has(username)) throw new Error("Este username é reservado.");
  // Só um super_admin pode criar uma conta que já nasce com acesso admin —
  // evita que um admin comum se aproveite do cadastro pra escalar privilégio.
  if (requestedRole && !(await isSuperAdmin())) throw new Error("Só um Super Admin pode criar uma conta já com acesso administrativo.");

  let newUserId: string;
  if (sendInvite) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://asic-monitor-saas-vercel.vercel.app";
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${appUrl}/dashboard`,
    });
    if (error) throw new Error(error.message);
    newUserId = data.user.id;
  } else {
    const { data, error } = await service.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true, user_metadata: { full_name: fullName, force_password_change: true },
    });
    if (error) throw new Error(error.message);
    newUserId = data.user.id;
  }

  if (username || requestedRole) {
    const patch: Record<string, unknown> = {};
    if (username) patch.username = username;
    if (requestedRole) patch.platform_role = requestedRole;
    const { error } = await service.from("profiles").update(patch).eq("id", newUserId);
    if (error) throw new Error(`Usuário criado, mas houve um erro ao aplicar username/permissão: ${error.message}`);
  }

  await logAdminAction(service, { adminId, targetUserId: newUserId, action: "user_create", newData: { email, full_name: fullName, username, invited: sendInvite, platform_role: requestedRole }, ipAddress: await clientIp() });
  revalidatePath("/admin/users");
  redirect(`/admin/users/${newUserId}`);
}
