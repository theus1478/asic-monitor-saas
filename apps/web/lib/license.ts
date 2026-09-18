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
 * Recalcula o resumo de `subscriptions` (total licenciado e fim do período) a
 * partir dos lotes ativos — usado depois de conceder/encerrar licenças à mão.
 * O controle real continua sendo `license_batches`; isto só mantém o resumo
 * (exibido no painel admin) coerente.
 */
export async function refreshSubscriptionLicenses(service: SupabaseClient, organizationId: string) {
  const nowIso = new Date().toISOString();
  const { data: active } = await service.from("license_batches").select("quantity, expires_at").eq("organization_id", organizationId).eq("status", "active").gt("expires_at", nowIso);
  const licensedMachines = (active ?? []).reduce((sum, batch) => sum + Number(batch.quantity), 0);
  const latestExpiry = (active ?? []).reduce<string | null>((latest, batch) => !latest || batch.expires_at > latest ? batch.expires_at : latest, null);
  const { data: subscription } = await service.from("subscriptions").select("id, status").eq("organization_id", organizationId).maybeSingle();
  if (subscription) {
    await service.from("subscriptions").update({ licensed_machines: licensedMachines, current_period_end: latestExpiry, ...(licensedMachines > 0 ? { status: "active" } : {}) }).eq("id", subscription.id);
  } else if (licensedMachines > 0) {
    await service.from("subscriptions").insert({ organization_id: organizationId, licensed_machines: licensedMachines, current_period_end: latestExpiry, status: "active" });
  }
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
