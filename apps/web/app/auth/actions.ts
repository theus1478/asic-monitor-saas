"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

function value(formData: FormData, field: string) {
  return String(formData.get(field) ?? "").trim();
}

export async function signIn(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const next = value(formData, "next");

  if (!email || !password) redirect("/sign-in?error=Preencha+e-mail+e+senha");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/sign-in?error=${encodeURIComponent("E-mail ou senha inválidos")}`);

  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(destination);
}

export async function signUp(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const fullName = value(formData, "fullName");

  if (!email || password.length < 8) {
    redirect(`/sign-in?mode=signup&error=${encodeURIComponent("Use um e-mail válido e uma senha com pelo menos 8 caracteres")}`);
  }

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${appUrl}/auth/callback` },
  });

  if (error) redirect(`/sign-in?mode=signup&error=${encodeURIComponent(error.message)}`);
  redirect(`/sign-in?message=${encodeURIComponent("Cadastro recebido. Verifique seu e-mail para ativar a conta.")}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
