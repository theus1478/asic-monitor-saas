"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "../../lib/supabase/server";

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
  const captchaToken = value(formData, "cf-turnstile-response") || undefined;
  const t = await getTranslations("auth");

  if (!email || password.length < 8) {
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent(t("invalidEmailPassword"))}`);
  }
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent(t("confirmNotRobot"))}`);
  }

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${appUrl}/auth/callback`, captchaToken },
  });

  if (error) redirect(`/sign-in?mode=signup&error=${encodeURIComponent(error.message)}`);
  redirect(`/sign-in?message=${encodeURIComponent(t("signupReceived"))}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
