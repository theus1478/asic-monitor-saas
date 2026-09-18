import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Shell } from "../../../components";
import { requirePlatformAdmin } from "../../../../lib/org-data";
import { isSuperAdmin } from "../../../../lib/admin/permissions";
import { getPlatformUserDetail } from "../../../../lib/admin/users";
import { createServiceClient } from "../../../../lib/supabase/service";
import { ProfileTab } from "./profile-tab";
import { LicensesCard, type LicenseOrg } from "./licenses-card";
import { EmailForm } from "./email-form";
import { PasswordActions } from "./password-actions";
import { StatusActions } from "./status-actions";
import { RoleForm } from "./role-form";
import { DeleteActions } from "./delete-actions";
import { VerificationActions } from "./verification-actions";

const STATUS_LABEL: Record<string, string> = { active: "Ativo", inactive: "Inativo", suspended: "Suspenso", blocked: "Bloqueado" };
const STATUS_BADGE: Record<string, string> = { active: "success", inactive: "neutral", suspended: "warning", blocked: "danger" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

// Organizações do usuário com seus lotes de licença e nº de máquinas — alimenta
// o cartão "Licenças" (concessão manual, só Super Admin).
async function loadLicenseOrgs(userId: string): Promise<LicenseOrg[]> {
  const service = createServiceClient();
  const { data: memberships } = await service.from("memberships").select("organization_id").eq("user_id", userId);
  const orgIds = [...new Set((memberships ?? []).map((m) => m.organization_id as string))];
  if (orgIds.length === 0) return [];
  const [{ data: orgs }, { data: batches }, { data: farms }] = await Promise.all([
    service.from("organizations").select("id, name").in("id", orgIds),
    service.from("license_batches").select("id, organization_id, quantity, status, starts_at, expires_at, invoice_id, created_at").in("organization_id", orgIds).order("created_at", { ascending: false }),
    service.from("farms").select("id, organization_id").in("organization_id", orgIds),
  ]);
  const farmIds = (farms ?? []).map((f) => f.id as string);
  const { data: miners } = farmIds.length ? await service.from("miners").select("farm_id").in("farm_id", farmIds) : { data: [] as { farm_id: string }[] };
  const orgByFarm = new Map((farms ?? []).map((f) => [f.id as string, f.organization_id as string]));
  const machinesByOrg = new Map<string, number>();
  for (const miner of miners ?? []) { const org = orgByFarm.get(miner.farm_id); if (org) machinesByOrg.set(org, (machinesByOrg.get(org) ?? 0) + 1); }
  const now = new Date().getTime();
  return (orgs ?? []).map((org) => {
    const orgBatches = (batches ?? []).filter((b) => b.organization_id === org.id);
    const activeQuantity = orgBatches.filter((b) => b.status === "active" && b.expires_at && new Date(b.expires_at).getTime() > now).reduce((sum, b) => sum + Number(b.quantity), 0);
    return {
      id: org.id as string, name: (org.name as string) ?? "Organização", activeQuantity, machines: machinesByOrg.get(org.id as string) ?? 0,
      batches: orgBatches.map((b) => ({ id: b.id as string, organization_id: b.organization_id as string, quantity: Number(b.quantity), status: b.status as string, starts_at: b.starts_at as string | null, expires_at: b.expires_at as string | null, has_invoice: Boolean(b.invoice_id) })),
    };
  });
}

const TABS = [
  { key: "profile", label: "Perfil" },
  { key: "asics", label: "ASICs" },
  { key: "farms", label: "Fazendas" },
  { key: "sessions", label: "Sessões" },
  { key: "history", label: "Histórico" },
] as const;

export default async function AdminUserDetailPage({ params, searchParams }: Props) {
  const { userId: adminId } = await requirePlatformAdmin();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "profile";

  const [user, canManageRoles] = await Promise.all([getPlatformUserDetail(id), isSuperAdmin()]);
  if (!user) notFound();
  const licenseOrgs = canManageRoles ? await loadLicenseOrgs(user.id) : [];

  const isSelf = user.id === adminId;

  return <Shell admin>
    <PageHeader
      title={user.fullName ?? user.email}
      description={`${user.email} · ID ${user.id}`}
      action={<Link href="/admin/users" className="button secondary">← Voltar</Link>}
    />

    <div className="inline-form" style={{ marginBottom: 20, gap: 10 }}>
      <span className={`badge ${STATUS_BADGE[user.accountStatus]}`}>{STATUS_LABEL[user.accountStatus]}</span>
      {user.platformRole && <span className="badge neutral">{user.platformRole === "super_admin" ? "Super Admin" : "Admin"}</span>}
      {user.emailConfirmed
        ? <span className="badge success">E-mail confirmado em {new Date(user.emailConfirmedAt!).toLocaleString("pt-BR")}</span>
        : <span className="badge warning">E-mail não verificado</span>}
      {user.bannedUntil && !user.deletedAt && <span className="badge danger">Acesso bloqueado</span>}
      {user.deletedAt && <span className="badge danger">Excluído</span>}
    </div>

    <nav className="tabs">
      {TABS.map((t) => {
        const disabled = t.key !== "profile";
        return disabled
          ? <a key={t.key} className="disabled" title="Em breve">{t.label} <small className="muted">em breve</small></a>
          : <Link key={t.key} href={`/admin/users/${id}?tab=${t.key}`} className={tab === t.key ? "active" : ""}>{t.label}</Link>;
      })}
    </nav>

    {tab === "profile" && <div style={{ display: "grid", gap: 20 }}>
      <ProfileTab user={user} />
      {canManageRoles && <LicensesCard userId={user.id} orgs={licenseOrgs} />}
      <EmailForm userId={user.id} currentEmail={user.email} currentUsername={user.username} pendingEmail={user.pendingEmail} />
      {!user.emailConfirmed && <VerificationActions userId={user.id} email={user.pendingEmail ?? user.email} canMarkConfirmed={canManageRoles} />}
      <PasswordActions userId={user.id} email={user.email} />
      <StatusActions userId={user.id} currentStatus={user.accountStatus} currentReason={user.statusReason} isSelf={isSelf} />
      {canManageRoles && <RoleForm userId={user.id} currentRole={user.platformRole} isSelf={isSelf} />}
      {canManageRoles && <DeleteActions
        userId={user.id} fullName={user.fullName} email={user.email}
        asicsCount={user.asicsCount} farmsCount={user.farmsCount}
        deletedAt={user.deletedAt} deletedByName={user.deletedByName} isSelf={isSelf}
      />}
    </div>}
  </Shell>;
}
