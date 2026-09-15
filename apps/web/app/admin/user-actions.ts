"use server";

import { requirePlatformAdmin } from "../../lib/org-data";
import { createServiceClient } from "../../lib/supabase/service";

/**
 * Dispara o e-mail padrão de redefinição de senha do Supabase para o usuário.
 * O admin nunca vê nem define a senha em si — só aciona o mesmo fluxo de
 * "esqueci minha senha" em nome do usuário, que continua escolhendo a senha
 * nova pelo link recebido.
 */
export async function sendPasswordReset(email: string) {
  await requirePlatformAdmin();
  const supabase = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://asic-monitor-saas-vercel.vercel.app";
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/sign-in` });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `E-mail de redefinição enviado para ${email}.` };
}
