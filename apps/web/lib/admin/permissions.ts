import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";

/** Só consulta, sem redirecionar — usado pra decidir se mostra ações restritas a super_admin (ex.: trocar o nível de acesso de outro admin). */
export async function isSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("platform_role")
    .eq("id", user.id)
    .maybeSingle();

  return profile?.platform_role === "super_admin";
}

/** Garante que o usuário logado é super_admin; caso contrário, manda para o /admin comum. */
export async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("platform_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.platform_role !== "super_admin") redirect("/admin");
  return { userId: user.id };
}

/**
 * Impede remover/rebaixar o último super_admin do sistema. Chamar ANTES de
 * gravar a mudança, passando o id do usuário que está sendo alterado (que
 * será excluído da contagem de super_admins restantes).
 */
export async function assertNotLastSuperAdmin(service: SupabaseClient, excludingUserId: string) {
  const { count } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("platform_role", "super_admin")
    .neq("id", excludingUserId);
  if (!count) throw new Error("Não é possível remover o último Super Admin do sistema.");
}
