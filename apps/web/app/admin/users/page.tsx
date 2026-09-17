import Link from "next/link";
import { PageHeader, Shell } from "../../components";
import { requirePlatformAdmin } from "../../../lib/org-data";
import { listPlatformUsers, type PlatformUserRow } from "../../../lib/admin/users";
import { currentTimeMs } from "../../../lib/time";

const PAGE_SIZE = 25;
const STATUS_LABEL: Record<PlatformUserRow["accountStatus"], string> = { active: "Ativo", inactive: "Inativo", suspended: "Suspenso", blocked: "Bloqueado" };
const STATUS_BADGE: Record<PlatformUserRow["accountStatus"], string> = { active: "success", inactive: "neutral", suspended: "warning", blocked: "danger" };
const ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", admin: "Admin", owner: "Dono", operator: "Operador", viewer: "Visualização" };

type Params = {
  q?: string; status?: string; role?: string; verified?: string; asics?: string; deleted?: string;
  page?: string; sort?: string; dir?: string;
};
type Props = { searchParams: Promise<Params> };

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

export default async function AdminUsersPage({ searchParams }: Props) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const allRows = await listPlatformUsers();
  const totalDeleted = allRows.filter((r) => r.deletedAt).length;
  const showDeleted = params.deleted === "show";
  const rows = showDeleted ? allRows : allRows.filter((r) => !r.deletedAt);

  const total = rows.length;
  const totalActive = rows.filter((r) => r.accountStatus === "active").length;
  const totalSuspended = rows.filter((r) => r.accountStatus === "suspended").length;
  const totalBlocked = rows.filter((r) => r.accountStatus === "blocked").length;
  const thirtyDaysAgo = currentTimeMs() - 30 * 24 * 60 * 60 * 1000;
  const totalNew = rows.filter((r) => new Date(r.createdAt).getTime() >= thirtyDaysAgo).length;
  const totalWithAsics = rows.filter((r) => r.asicsCount > 0).length;
  const totalWithoutAsics = total - totalWithAsics;
  const totalAdmins = rows.filter((r) => r.platformRole).length;

  const q = (params.q ?? "").trim().toLowerCase();
  const status = params.status ?? "";
  const role = params.role ?? "";
  const verified = params.verified ?? "";
  const asics = params.asics ?? "";
  const sort = params.sort ?? "createdAt";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.page) || 1);

  let filtered = rows;
  if (q) {
    filtered = filtered.filter((r) =>
      r.fullName?.toLowerCase().includes(q) || r.username?.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) || r.organizationName?.toLowerCase().includes(q));
  }
  if (status) filtered = filtered.filter((r) => r.accountStatus === status);
  if (role === "admin") filtered = filtered.filter((r) => r.platformRole);
  if (role === "regular") filtered = filtered.filter((r) => !r.platformRole);
  if (verified === "yes") filtered = filtered.filter((r) => r.emailConfirmed);
  if (verified === "no") filtered = filtered.filter((r) => !r.emailConfirmed);
  if (asics === "yes") filtered = filtered.filter((r) => r.asicsCount > 0);
  if (asics === "no") filtered = filtered.filter((r) => r.asicsCount === 0);

  const sortKey = (r: PlatformUserRow): string | number => {
    switch (sort) {
      case "name": return r.fullName ?? r.email;
      case "asics": return r.asicsCount;
      case "farms": return r.farmsCount;
      case "lastLogin": return r.lastSignInAt ?? "";
      default: return r.createdAt;
    }
  };
  filtered = [...filtered].sort((a, b) => {
    const av = sortKey(a), bv = sortKey(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const buildHref = (next: Partial<Params>) => {
    const merged = { q: params.q ?? "", status, role, verified, asics, deleted: params.deleted ?? "", sort, dir, ...next };
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)));
    return `/admin/users${qs.toString() ? `?${qs}` : ""}`;
  };
  const sortHref = (key: string) => buildHref({ page: "1", sort: key, dir: sort === key && dir === "desc" ? "asc" : "desc" });
  const pill = (href: string, active: boolean, label: string) => <Link key={href} href={href} className={`button compact ${active ? "" : "secondary"}`}>{label}</Link>;

  return <Shell admin>
    <PageHeader title="Gestão de Usuários" description="Contas, acessos e ciclo de vida de usuários da plataforma." action={<Link href="/admin/users/new" className="button">+ Novo usuário</Link>} />

    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">TOTAL DE USUÁRIOS</p><div className="metric">{total}</div></article>
      <article className="card"><p className="eyebrow">ATIVOS</p><div className="metric">{totalActive}</div></article>
      <article className="card"><p className="eyebrow">SUSPENSOS</p><div className="metric">{totalSuspended}</div></article>
      <article className="card"><p className="eyebrow">BLOQUEADOS</p><div className="metric">{totalBlocked}</div></article>
      <article className="card"><p className="eyebrow">NOVOS (30 DIAS)</p><div className="metric">{totalNew}</div></article>
      <article className="card"><p className="eyebrow">COM ASIC</p><div className="metric">{totalWithAsics}</div><p className="muted">sem ASIC: {totalWithoutAsics}</p></article>
      <article className="card"><p className="eyebrow">ADMINISTRADORES</p><div className="metric">{totalAdmins}</div></article>
      <article className="card"><p className="eyebrow">EXCLUÍDOS</p><div className="metric">{totalDeleted}</div></article>
    </section>

    <section className="card table-card">
      <div className="section-title"><div><h2>Usuários</h2><p>Busque, filtre e clique numa linha para ver o detalhe da conta.</p></div></div>

      <form className="inline-form" style={{ marginBottom: 14 }}>
        <input type="hidden" name="status" value={status} /><input type="hidden" name="role" value={role} />
        <input type="hidden" name="verified" value={verified} /><input type="hidden" name="asics" value={asics} />
        <input type="hidden" name="deleted" value={params.deleted ?? ""} />
        <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar por nome, username, e-mail, ID ou organização..." />
        <button className="button secondary" type="submit">Buscar</button>
      </form>

      <div className="inline-form" style={{ flexWrap: "wrap", marginBottom: 18, gap: 8 }}>
        {pill(buildHref({ status: "" }), status === "", "Todos")}
        {pill(buildHref({ status: "active" }), status === "active", "Ativos")}
        {pill(buildHref({ status: "inactive" }), status === "inactive", "Inativos")}
        {pill(buildHref({ status: "suspended" }), status === "suspended", "Suspensos")}
        {pill(buildHref({ status: "blocked" }), status === "blocked", "Bloqueados")}
        <span className="muted" style={{ alignSelf: "center", margin: "0 4px" }}>·</span>
        {pill(buildHref({ role: "" }), role === "", "Qualquer perfil")}
        {pill(buildHref({ role: "admin" }), role === "admin", "Administradores")}
        {pill(buildHref({ role: "regular" }), role === "regular", "Usuários comuns")}
        <span className="muted" style={{ alignSelf: "center", margin: "0 4px" }}>·</span>
        {pill(buildHref({ verified: "" }), verified === "", "E-mail: todos")}
        {pill(buildHref({ verified: "yes" }), verified === "yes", "Verificado")}
        {pill(buildHref({ verified: "no" }), verified === "no", "Não verificado")}
        <span className="muted" style={{ alignSelf: "center", margin: "0 4px" }}>·</span>
        {pill(buildHref({ asics: "" }), asics === "", "ASICs: todos")}
        {pill(buildHref({ asics: "yes" }), asics === "yes", "Com ASIC")}
        {pill(buildHref({ asics: "no" }), asics === "no", "Sem ASIC")}
        <span className="muted" style={{ alignSelf: "center", margin: "0 4px" }}>·</span>
        {pill(buildHref({ deleted: showDeleted ? "" : "show" }), showDeleted, showDeleted ? "Ocultar excluídos" : `Mostrar excluídos (${totalDeleted})`)}
      </div>

      {pageRows.length === 0
        ? <p className="muted">Nenhum usuário encontrado com esses filtros.</p>
        : <div className="table-wrap"><table>
            <thead><tr>
              <th><Link href={sortHref("name")}>Nome</Link></th>
              <th>Username</th><th>E-mail</th><th>Perfil</th><th>Organização</th>
              <th><Link href={sortHref("asics")}>ASICs</Link></th>
              <th><Link href={sortHref("farms")}>Fazendas</Link></th>
              <th>Status</th>
              <th><Link href={sortHref("createdAt")}>Criado em</Link></th>
              <th><Link href={sortHref("lastLogin")}>Último login</Link></th>
              <th>Verificado</th><th>2FA</th>
            </tr></thead>
            <tbody>{pageRows.map((r) => <tr key={r.id}>
              <td><Link href={`/admin/users/${r.id}`}><b>{r.fullName ?? "—"}</b></Link><small>{r.id}</small></td>
              <td>{r.username ? `@${r.username}` : "—"}</td>
              <td>{r.email}</td>
              <td>{r.platformRole ? ROLE_LABEL[r.platformRole] : (r.membershipRole ? ROLE_LABEL[r.membershipRole] ?? r.membershipRole : "—")}</td>
              <td>{r.organizationName ?? "—"}</td>
              <td>{r.asicsCount}</td>
              <td>{r.farmsCount}</td>
              <td>{r.deletedAt ? <span className="badge danger">Excluído</span> : <span className={`badge ${STATUS_BADGE[r.accountStatus]}`}>{STATUS_LABEL[r.accountStatus]}</span>}</td>
              <td>{fmtDate(r.createdAt)}</td>
              <td>{fmtDate(r.lastSignInAt)}</td>
              <td>{r.emailConfirmed ? <span title={new Date(r.emailConfirmedAt!).toLocaleString("pt-BR")}>✓</span> : "—"}</td>
              <td>{r.mfaEnabled ? "✓" : "—"}</td>
            </tr>)}</tbody>
          </table></div>}

      {totalPages > 1 && <div className="inline-form" style={{ marginTop: 16, justifyContent: "center" }}>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) =>
          <Link key={p} href={buildHref({ page: String(p) })} className={`button compact ${p === currentPage ? "" : "secondary"}`}>{p}</Link>)}
      </div>}
    </section>
  </Shell>;
}
