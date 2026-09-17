import type { SupabaseClient } from "@supabase/supabase-js";

type AuditEntry = {
  adminId: string;
  targetUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
};

/**
 * Registra uma ação administrativa em admin_audit_logs. Nunca deve receber
 * senha/token em oldData/newData — quem chama é responsável por omitir esses
 * campos antes de passar o snapshot.
 */
export async function logAdminAction(service: SupabaseClient, entry: AuditEntry) {
  await service.from("admin_audit_logs").insert({
    admin_id: entry.adminId,
    target_user_id: entry.targetUserId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? "user",
    entity_id: entry.entityId ?? entry.targetUserId ?? null,
    old_data: entry.oldData ?? null,
    new_data: entry.newData ?? null,
    reason: entry.reason ?? null,
    ip_address: entry.ipAddress ?? null,
  });
}
