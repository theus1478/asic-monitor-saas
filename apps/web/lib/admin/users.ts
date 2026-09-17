import { createServiceClient } from "../supabase/service";

export type PlatformUserRow = {
  id: string;
  fullName: string | null;
  username: string | null;
  email: string;
  emailConfirmed: boolean;
  platformRole: "super_admin" | "admin" | null;
  organizationId: string | null;
  organizationName: string | null;
  membershipRole: string | null;
  farmsCount: number;
  asicsCount: number;
  accountStatus: "active" | "inactive" | "suspended" | "blocked";
  statusReason: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  mfaEnabled: boolean;
};

export type PlatformUserDetail = PlatformUserRow & {
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  timezone: string | null;
  country: string | null;
  locale: string | null;
  adminNotes: string | null;
};

type Service = ReturnType<typeof createServiceClient>;

/** Junta profiles + auth.users + memberships/farms/miners num único array em memória — mesmo padrão já usado em admin/page.tsx pro dashboard de organizações. */
async function loadAllRows(service: Service): Promise<PlatformUserRow[]> {
  const [{ data: profiles }, { data: authList }, { data: memberships }, { data: organizations }, { data: farms }, { data: miners }] = await Promise.all([
    service.from("profiles").select("id, full_name, username, platform_role, account_status, status_reason"),
    service.auth.admin.listUsers({ perPage: 1000 }),
    service.from("memberships").select("organization_id, user_id, role"),
    service.from("organizations").select("id, name"),
    service.from("farms").select("id, organization_id"),
    service.from("miners").select("id, farm_id").eq("enabled", true),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const orgNameById = new Map((organizations ?? []).map((o) => [o.id, o.name]));
  const farmCountByOrg = new Map<string, number>();
  const farmIdsByOrg = new Map<string, string[]>();
  for (const farm of farms ?? []) {
    farmCountByOrg.set(farm.organization_id, (farmCountByOrg.get(farm.organization_id) ?? 0) + 1);
    if (!farmIdsByOrg.has(farm.organization_id)) farmIdsByOrg.set(farm.organization_id, []);
    farmIdsByOrg.get(farm.organization_id)!.push(farm.id);
  }
  const farmToOrg = new Map((farms ?? []).map((f) => [f.id, f.organization_id]));
  const minerCountByOrg = new Map<string, number>();
  for (const miner of miners ?? []) {
    const orgId = farmToOrg.get(miner.farm_id);
    if (orgId) minerCountByOrg.set(orgId, (minerCountByOrg.get(orgId) ?? 0) + 1);
  }

  const membershipsByUser = new Map<string, { organization_id: string; role: string }[]>();
  for (const m of memberships ?? []) {
    if (!membershipsByUser.has(m.user_id)) membershipsByUser.set(m.user_id, []);
    membershipsByUser.get(m.user_id)!.push(m);
  }

  return (authList?.users ?? []).map((authUser) => {
    const profile = profileById.get(authUser.id);
    const userMemberships = membershipsByUser.get(authUser.id) ?? [];
    const primary = userMemberships.find((m) => m.role === "owner") ?? userMemberships[0];
    const orgIds = [...new Set(userMemberships.map((m) => m.organization_id))];

    return {
      id: authUser.id,
      fullName: profile?.full_name ?? (authUser.user_metadata?.full_name as string | undefined) ?? null,
      username: profile?.username ?? null,
      email: authUser.email ?? "—",
      emailConfirmed: Boolean(authUser.email_confirmed_at),
      platformRole: (profile?.platform_role as PlatformUserRow["platformRole"]) ?? null,
      organizationId: primary?.organization_id ?? null,
      organizationName: primary ? orgNameById.get(primary.organization_id) ?? null : null,
      membershipRole: primary?.role ?? null,
      farmsCount: orgIds.reduce((sum, id) => sum + (farmCountByOrg.get(id) ?? 0), 0),
      asicsCount: orgIds.reduce((sum, id) => sum + (minerCountByOrg.get(id) ?? 0), 0),
      accountStatus: (profile?.account_status as PlatformUserRow["accountStatus"]) ?? "active",
      statusReason: profile?.status_reason ?? null,
      createdAt: authUser.created_at,
      lastSignInAt: authUser.last_sign_in_at ?? null,
      bannedUntil: authUser.banned_until ?? null,
      mfaEnabled: Boolean(authUser.factors && authUser.factors.length > 0),
    } satisfies PlatformUserRow;
  });
}

export async function listPlatformUsers(): Promise<PlatformUserRow[]> {
  const service = createServiceClient();
  const rows = await loadAllRows(service);
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getPlatformUserDetail(userId: string): Promise<PlatformUserDetail | null> {
  const service = createServiceClient();
  const [{ data: profile }, rows] = await Promise.all([
    service.from("profiles").select("phone, company, job_title, timezone, country, locale, admin_notes").eq("id", userId).maybeSingle(),
    loadAllRows(service),
  ]);
  const base = rows.find((r) => r.id === userId);
  if (!base) return null;
  return {
    ...base,
    phone: profile?.phone ?? null,
    company: profile?.company ?? null,
    jobTitle: profile?.job_title ?? null,
    timezone: profile?.timezone ?? null,
    country: profile?.country ?? null,
    locale: profile?.locale ?? null,
    adminNotes: profile?.admin_notes ?? null,
  };
}
