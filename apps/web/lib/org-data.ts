import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/** Organização do usuário logado, via a primeira membership encontrada. */
export async function getOrganizationId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, organizationId: null as string | null };

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return { supabase, organizationId: (membership?.organization_id as string | undefined) ?? null };
}

/** Só consulta, sem redirecionar — usado pra decidir se mostra o atalho pro painel admin. */
export async function isPlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  return Boolean(profile?.platform_admin);
}

/** Garante que o usuário logado é platform_admin; caso contrário, manda para o dashboard do cliente. */
export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.platform_admin) redirect("/dashboard");
  return { userId: user.id };
}
