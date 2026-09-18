import { randomInt } from "crypto";
import { Resend } from "resend";

// Sem caracteres ambíguos (0/O, 1/l/I) — a senha é lida num e-mail e digitada à mão.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateTemporaryPassword(length = 12) {
  return Array.from({ length }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function buildHtml(password: string, forceChange: boolean, signInUrl: string) {
  return `<div style="background:#090d13;padding:32px 16px;font-family:Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#121924;border:1px solid #263248;border-radius:12px;padding:24px;text-align:center">
      <p style="color:#42dba3;font-size:11px;font-weight:700;letter-spacing:.1em;margin:0 0 6px">ASIC MONITOR CLOUD</p>
      <h1 style="color:#e8eef9;font-size:18px;margin:0 0 18px">Sua senha foi redefinida por um administrador</h1>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 10px">Use esta senha para entrar:</p>
      <p style="font:700 26px ui-monospace,Consolas,monospace;letter-spacing:.08em;color:#42dba3;background:#0a1018;border-radius:10px;padding:16px;margin:0 0 18px">${escapeHtml(password)}</p>
      <p style="margin:0 0 18px"><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#42dba3;color:#04120c;font-weight:700;text-decoration:none;border-radius:8px;padding:10px 22px">Entrar</a></p>
      ${forceChange ? '<p style="color:#94a3b8;font-size:13px;margin:0 0 6px">Por segurança, você será solicitado(a) a criar uma nova senha no primeiro acesso.</p>' : ""}
      <p style="color:#94a3b8;font-size:13px;margin:0">Se você não esperava este e-mail, entre em contato com o suporte.</p>
    </div>
  </div>`;
}

export async function sendTemporaryPasswordEmail(params: { email: string; password: string; forceChange: boolean }): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, message: "Envio de e-mail não configurado (RESEND_API_KEY)." };
  const from = process.env.ALERT_EMAIL_FROM || "ASIC Monitor <alerts@resend.dev>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monitorasic.club";
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to: [params.email], subject: "Sua senha temporária - ASIC Monitor", html: buildHtml(params.password, params.forceChange, `${appUrl}/sign-in`) });
    if (error) return { ok: false, message: error.message ?? "Falha ao enviar e-mail." };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Falha desconhecida ao enviar e-mail." };
  }
}
