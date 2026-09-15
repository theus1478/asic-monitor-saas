import type { SupabaseClient } from "@supabase/supabase-js";

/** Soma das licenças ativas (não expiradas) de uma organização. */
export async function getLicensedMachineCount(supabase: SupabaseClient, organizationId: string): Promise<number> {
  const { data } = await supabase
    .from("license_batches")
    .select("quantity")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  return (data ?? []).reduce((total, batch) => total + Number(batch.quantity), 0);
}

/**
 * Marca quais máquinas de uma organização estão cobertas pela licença. As
 * mais antigas (por data de cadastro) ficam licenciadas primeiro — se o
 * cliente reduzir a licença, as máquinas mais novas é que ficam pendentes.
 */
export function markLicensed<T extends { id: string; created_at: string }>(miners: T[], licensedCount: number) {
  const ordered = [...miners].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const licensedIds = new Set(ordered.slice(0, licensedCount).map((m) => m.id));
  return new Map(miners.map((m) => [m.id, licensedIds.has(m.id)]));
}
