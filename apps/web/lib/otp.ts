import { randomInt, createHash, timingSafeEqual } from "crypto";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAdminAction } from "./admin/audit";

export type OtpPurpose = "email_verification" | "email_change";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

type SendResult = { ok: true } | { ok: false; message: string; retryAfterSeconds?: number };
type VerifyResult = { ok: true } | { ok: false; message: string; code: "invalid" | "expired" | "locked" | "none" };

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function buildOtpEmailHtml(code: string) {
  return `<div style="background:#090d13;padding:32px 16px;font-family:Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#121924;border:1px solid #263248;border-radius:12px;padding:24px;text-align:center">
      <p style="color:#42dba3;font-size:11px;font-weight:700;letter-spacing:.1em;margin:0 0 6px">ASIC MONITOR CLOUD</p>
      <h1 style="color:#e8eef9;font-size:18px;margin:0 0 18px">Use o código abaixo para confirmar seu e-mail:</h1>
      <p style="font:700 34px ui-monospace,Consolas,monospace;letter-spacing:.15em;color:#42dba3;background:#0a1018;border-radius:10px;padding:16px;margin:0 0 18px">${escapeHtml(code)}</p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 6px">Este código expira em 10 minutos.</p>
      <p style="color:#94a3b8;font-size:13px;margin:0">Se você não solicitou este código, ignore este e-mail.</p>
    </div>
  </div>`;
}

async function sendOtpEmail(email: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false as const, message: "Envio de e-mail não configurado (RESEND_API_KEY)." };
  const from = process.env.ALERT_EMAIL_FROM || "ASIC Monitor <alerts@resend.dev>";
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to: [email], subject: "Seu código de confirmação", html: buildOtpEmailHtml(code) });
    if (error) return { ok: false as const, message: error.message ?? "Falha ao enviar e-mail." };
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Falha desconhecida ao enviar e-mail." };
  }
}

/**
 * Gera e envia um novo código, invalidando qualquer código ainda ativo do
 * mesmo user_id+purpose (só um código ativo por vez). Aplica cooldown de
 * reenvio e um limite de envios por hora antes de gerar - devolve
 * retryAfterSeconds quando bloqueado, pra a UI mostrar a contagem regressiva.
 */
export async function generateAndSendCode(
  service: SupabaseClient,
  params: { userId: string; email: string; purpose: OtpPurpose; actorId?: string },
): Promise<SendResult> {
  const { userId, email, purpose, actorId } = params;

  const { data: recent } = await service
    .from("email_verification_codes")
    .select("created_at, used_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const elapsedMs = Date.now() - new Date(recent.created_at).getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      return { ok: false, message: "Aguarde antes de solicitar um novo código.", retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000) };
    }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await service
    .from("email_verification_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= MAX_SENDS_PER_HOUR) {
    return { ok: false, message: "Muitas tentativas de reenvio. Tente novamente mais tarde." };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sendResult = await sendOtpEmail(email, code);
  if (!sendResult.ok) return sendResult;

  await service.from("email_verification_codes").update({ used_at: new Date().toISOString() }).eq("user_id", userId).eq("purpose", purpose).is("used_at", null);

  const { error } = await service.from("email_verification_codes").insert({
    user_id: userId, email, purpose, code_hash: hashCode(code), expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, message: error.message };

  await logAdminAction(service, {
    adminId: actorId ?? userId, targetUserId: userId, action: recent ? "verification_code_resent" : "verification_code_sent",
    entityType: "email_verification_code", newData: { purpose, email },
  });
  return { ok: true };
}

/**
 * Confirma o código ativo mais recente do user_id+purpose. Nunca aceita um
 * código criado para outro propósito (email_change não valida contra um
 * código de email_verification e vice-versa). Em erro, incrementa attempts
 * e invalida o código ao chegar no limite - quem chama não recebe o
 * code_hash nem qualquer coisa que permita adivinhar o código certo.
 */
export async function verifyCode(
  service: SupabaseClient,
  params: { userId: string; purpose: OtpPurpose; code: string },
): Promise<VerifyResult> {
  const { userId, purpose, code } = params;

  const { data: active } = await service
    .from("email_verification_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!active) {
    await logAdminAction(service, { adminId: userId, targetUserId: userId, action: "verification_failed", entityType: "email_verification_code", newData: { purpose, reason: "no_active_code" } });
    return { ok: false, code: "none", message: "Nenhum código ativo. Solicite um novo código." };
  }

  if (new Date(active.expires_at).getTime() < Date.now()) {
    await service.from("email_verification_codes").update({ used_at: new Date().toISOString() }).eq("id", active.id);
    return { ok: false, code: "expired", message: "Este código expirou. Solicite um novo código." };
  }

  const providedHash = hashCode(code);
  const match = providedHash.length === active.code_hash.length && timingSafeEqual(Buffer.from(providedHash), Buffer.from(active.code_hash));

  if (!match) {
    const attempts = active.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await service.from("email_verification_codes").update({ attempts, used_at: new Date().toISOString() }).eq("id", active.id);
      await logAdminAction(service, { adminId: userId, targetUserId: userId, action: "verification_locked", entityType: "email_verification_code", newData: { purpose } });
      return { ok: false, code: "locked", message: "Muitas tentativas incorretas. Solicite um novo código." };
    }
    await service.from("email_verification_codes").update({ attempts }).eq("id", active.id);
    await logAdminAction(service, { adminId: userId, targetUserId: userId, action: "verification_failed", entityType: "email_verification_code", newData: { purpose, attempts } });
    return { ok: false, code: "invalid", message: "Código incorreto. Verifique o código enviado para seu e-mail." };
  }

  await service.from("email_verification_codes").update({ used_at: new Date().toISOString() }).eq("id", active.id);
  return { ok: true };
}
