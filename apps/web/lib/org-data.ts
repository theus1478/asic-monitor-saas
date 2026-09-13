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
