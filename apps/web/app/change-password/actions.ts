"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "../../lib/supabase/server";

export async function changePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const t = await getTranslations("auth");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  if (password.length < 8) redirect(`/change-password?error=${encodeURIComponent(t("passwordTooShort"))}`);
  if (password !== confirm) redirect(`/change-password?error=${encodeURIComponent(t("passwordMismatch"))}`);

  // `data` mescla em user_metadata: limpa a exigência de troca do primeiro acesso.
  const { error } = await supabase.auth.updateUser({ password, data: { force_password_change: false } });
  if (error) redirect(`/change-password?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}
