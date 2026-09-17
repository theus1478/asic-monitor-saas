"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";
import { generateAndSendCode, verifyCode, type OtpPurpose } from "../../lib/otp";
import { logAdminAction } from "../../lib/admin/audit";

type ActionResult = { ok: boolean; message: string; retryAfterSeconds?: number };

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  return user;
}

async function resolvePurposeAndEmail(service: ReturnType<typeof createServiceClient>, userId: string, fallbackEmail: string) {
  const { data: profile } = await service.from("profiles").select("pending_email").eq("id", userId).maybeSingle();
  const purpose: OtpPurpose = profile?.pending_email ? "email_change" : "email_verification";
  return { purpose, email: profile?.pending_email ?? fallbackEmail, pendingEmail: profile?.pending_email ?? null };
}

export async function submitCode(code: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Código incorreto. Verifique o código enviado para seu e-mail." };

  const service = createServiceClient();
  const { purpose, pendingEmail } = await resolvePurposeAndEmail(service, user.id, user.email ?? "");

  const result = await verifyCode(service, { userId: user.id, purpose, code });
  if (!result.ok) return { ok: false, message: result.message };

  if (purpose === "email_change" && pendingEmail) {
    await service.auth.admin.updateUserById(user.id, { email: pendingEmail, email_confirm: true });
    await service.from("profiles").update({ pending_email: null }).eq("id", user.id);
    await logAdminAction(service, { adminId: user.id, targetUserId: user.id, action: "email_change_verified", newData: { email: pendingEmail } });
  } else {
    await service.auth.admin.updateUserById(user.id, { email_confirm: true });
    await logAdminAction(service, { adminId: user.id, targetUserId: user.id, action: "email_verified" });
  }

  return { ok: true, message: "E-mail confirmado com sucesso." };
}

export async function resendCode(): Promise<ActionResult> {
  const user = await requireUser();
  const service = createServiceClient();
  const { purpose, email } = await resolvePurposeAndEmail(service, user.id, user.email ?? "");
  const result = await generateAndSendCode(service, { userId: user.id, email, purpose });
  if (!result.ok) return { ok: false, message: result.message, retryAfterSeconds: "retryAfterSeconds" in result ? result.retryAfterSeconds : undefined };
  return { ok: true, message: "Código reenviado." };
}
