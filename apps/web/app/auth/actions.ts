"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";
import { generateAndSendCode } from "../../lib/otp";

function value(formData: FormData, field: string) {
  return String(formData.get(field) ?? "").trim();
}

export async function signIn(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const next = value(formData, "next");
  const captchaToken = value(formData, "cf-turnstile-response") || undefined;
  const t = await getTranslations("auth");

  if (!email || !password) redirect(`/sign-in?error=${encodeURIComponent(t("fillEmailPassword"))}`);
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
    redirect(`/sign-in?next=${encodeURIComponent(next)}&error=${encodeURIComponent(t("confirmNotRobot"))}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) redirect(`/sign-in?next=${encodeURIComponent(next)}&error=${encodeURIComponent(t("invalidCredentials"))}`);

  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(destination);
}

export async function signUp(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const fullName = value(formData, "fullName");
  const referralCode = value(formData, "referralCode").toUpperCase().slice(0, 16);
  const captchaToken = value(formData, "cf-turnstile-response") || undefined;
  const t = await getTranslations("auth");

  if (!email || password.length < 8) {
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent(t("invalidEmailPassword"))}`);
  }
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent(t("confirmNotRobot"))}`);
  }

  const service = createServiceClient();

  // Criado via API administrativa (não o signUp anônimo) pra nascer com
  // email_confirm: false, sem disparar o e-mail de confirmação nativo do
  // Supabase — a confirmação inteira passa a ser pelo código de 6 dígitos.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email, password, email_confirm: false,
    user_metadata: { full_name: fullName, referral_code: referralCode || undefined },
  });

  if (createError) {
    // "email_exists" é o código do GoTrue pra e-mail duplicado; checa a
    // mensagem também como reforço, já que o código pode variar por versão.
    const isDuplicate = createError.code === "email_exists" || createError.message.toLowerCase().includes("already");
    const message = isDuplicate ? t("emailAlreadyRegistered") : createError.message;
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent(message)}`);
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (signInError) {
    // O captcha (e qualquer outra verificação do signInWithPassword) só é
    // checado aqui, já que a criação em si usa a API administrativa, que não
    // recebe captchaToken — sem sessão válida, a conta criada é inútil e é
    // desfeita pra não deixar um registro órfão sem verificação alguma.
    await service.auth.admin.deleteUser(created.user.id);
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent(t("confirmNotRobot"))}`);
  }

  await generateAndSendCode(service, { userId: created.user.id, email, purpose: "email_verification" });
  (await cookies()).delete("ref_code");
  redirect("/verify-email");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
