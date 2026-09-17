import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Shell } from "../../../components";
import { requirePlatformAdmin } from "../../../../lib/org-data";
import { isSuperAdmin } from "../../../../lib/admin/permissions";
import { getPlatformUserDetail } from "../../../../lib/admin/users";
import { ProfileTab } from "./profile-tab";
import { EmailForm } from "./email-form";
import { PasswordActions } from "./password-actions";
import { StatusActions } from "./status-actions";
import { RoleForm } from "./role-form";
import { DeleteActions } from "./delete-actions";

const STATUS_LABEL: Record<string, string> = { active: "Ativo", inactive: "Inativo", suspended: "Suspenso", blocked: "Bloqueado" };
const STATUS_BADGE: Record<string, string> = { active: "success", inactive: "neutral", suspended: "warning", blocked: "danger" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

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
      {!user.emailConfirmed && <span className="badge warning">E-mail não verificado</span>}
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
      <EmailForm userId={user.id} currentEmail={user.email} currentUsername={user.username} />
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
