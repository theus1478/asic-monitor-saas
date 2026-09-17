import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Shell } from "../../../components";
import { requirePlatformAdmin } from "../../../../lib/org-data";
import { createServiceClient } from "../../../../lib/supabase/service";
import { getLicensedMachineCount } from "../../../../lib/license";
import { currentTimeMs } from "../../../../lib/time";
import { ResetPasswordButton } from "./reset-password-button";

const FRESH_MS = 90_000;
const INVOICE_LABEL: Record<string, string> = { paid: "Pago", pending: "Pendente", expired: "Expirada", cancelled: "Cancelada" };
const BATCH_LABEL: Record<string, string> = { active: "Ativo", pending: "Aguardando pagamento", expired: "Expirado", cancelled: "Cancelado" };

function formatHashrate(ths: number) {
  if (ths >= 1000) return `${(ths / 1000).toFixed(2)} PH/s`;
  return `${ths.toFixed(2)} TH/s`;
}

export default async function AdminOrgPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: org } = await supabase.from("organizations").select("id, name, created_at").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [{ data: memberships }, { data: usersList }, { data: farms }, { data: invoices }, { data: batches }, licensedCount] = await Promise.all([
    supabase.from("memberships").select("user_id, role").eq("organization_id", id),
    supabase.auth.admin.listUsers({ perPage: 1000 }),
    supabase.from("farms").select("id, name, timezone").eq("organization_id", id).order("created_at"),
    supabase.from("invoices").select("id, reference, amount_usdt, status, created_at, paid_at, due_at").eq("organization_id", id).order("created_at", { ascending: false }),
    supabase.from("license_batches").select("id, quantity, status, starts_at, expires_at, created_at").eq("organization_id", id).order("created_at", { ascending: false }),
    getLicensedMachineCount(supabase, id),
  ]);

  const emailByUserId = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? "—"]));
  const members = (memberships ?? []).map((m) => ({ userId: m.user_id, email: emailByUserId.get(m.user_id) ?? "—", role: m.role }));
  const ownerEmail = members.find((m) => m.role === "owner")?.email ?? members[0]?.email ?? null;

  const farmList = farms ?? [];
  const farmIds = farmList.map((f) => f.id);
  const { data: miners } = farmIds.length
    ? await supabase.from("miners").select("id, farm_id, name, ip, type").in("farm_id", farmIds)
    : { data: [] as { id: string; farm_id: string; name: string; ip: string; type: string }[] };
  const minerList = miners ?? [];
  const minerIds = minerList.map((m) => m.id);
  const farmNameById = new Map(farmList.map((f) => [f.id, f.name]));

  const { data: recentMetrics } = minerIds.length
    ? await supabase.from("miner_metrics").select("miner_id, online, hashrate_ths, power_w, observed_at").in("miner_id", minerIds).order("observed_at", { ascending: false }).limit(Math.max(500, minerIds.length * 3))
    : { data: [] as { miner_id: string; online: boolean; hashrate_ths: number | null; power_w: number | null; observed_at: string }[] };
  const latestByMiner = new Map<string, { online: boolean; hashrate_ths: number | null; power_w: number | null; observed_at: string }>();
  for (const metric of recentMetrics ?? []) {
    if (!latestByMiner.has(metric.miner_id)) latestByMiner.set(metric.miner_id, metric);
  }
  const now = currentTimeMs();
  const minerRows = minerList.map((miner) => {
    const metric = latestByMiner.get(miner.id);
    const fresh = Boolean(metric && now - new Date(metric.observed_at).getTime() <= FRESH_MS);
    const online = Boolean(metric?.online && fresh);
    return { ...miner, farmName: farmNameById.get(miner.farm_id) ?? "—", online, hashrate: online ? metric?.hashrate_ths ?? 0 : 0, power: online ? metric?.power_w ?? 0 : 0 };
  });
  const totalHashrate = minerRows.reduce((sum, m) => sum + m.hashrate, 0);
  const totalPower = minerRows.reduce((sum, m) => sum + m.power, 0);
  const onlineCount = minerRows.filter((m) => m.online).length;

  return <Shell admin>
    <PageHeader title={org.name} description={`Cliente desde ${new Date(org.created_at).toLocaleDateString("pt-BR")}`} action={<Link href="/admin#clientes" className="button secondary">← Voltar</Link>} />

    <section className="metrics-grid">
      <article className="card"><p className="eyebrow">MÁQUINAS ONLINE</p><div className="metric">{onlineCount}<span>/{minerRows.length}</span></div></article>
      <article className="card"><p className="eyebrow">HASHRATE TOTAL</p><div className="metric">{formatHashrate(totalHashrate)}</div></article>
      <article className="card"><p className="eyebrow">CONSUMO</p><div className="metric">{(totalPower / 1000).toFixed(2)}<span> kW</span></div></article>
      <article className="card"><p className="eyebrow">LICENÇAS ATIVAS</p><div className="metric">{licensedCount}</div></article>
    </section>

    <section className="card">
      <h2>Acesso</h2>
      {members.length === 0
        ? <p className="muted">Nenhum usuário vinculado.</p>
        : <ul className="agent-list">{members.map((m) => <li key={m.userId}><Link href={`/admin/users/${m.userId}`}>{m.email}</Link> <span className="muted">· {m.role}</span></li>)}</ul>}
      {ownerEmail && <ResetPasswordButton email={ownerEmail} />}
    </section>

    <section className="card table-card">
      <h2>Máquinas ({minerRows.length})</h2>
      {minerRows.length === 0
        ? <p className="muted">Nenhuma máquina cadastrada.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Máquina</th><th>Fazenda</th><th>IP</th><th>Tipo</th><th>Status</th><th>TH/s</th></tr></thead>
            <tbody>{minerRows.map((m) => <tr key={m.id}>
              <td>{m.name}</td><td className="muted">{m.farmName}</td><td className="lm-mono">{m.ip}</td><td>{m.type}</td>
              <td><span className={`status-dot ${m.online ? "" : "off"}`} /> {m.online ? "online" : "offline"}</td>
              <td>{m.online ? m.hashrate.toFixed(2) : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    <section className="card table-card">
      <h2>Faturas</h2>
      {(invoices ?? []).length === 0
        ? <p className="muted">Nenhuma fatura gerada ainda.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Referência</th><th>Valor</th><th>Status</th><th>Criada em</th><th>Paga em</th></tr></thead>
            <tbody>{(invoices ?? []).map((inv) => <tr key={inv.id}>
              <td className="lm-mono">{inv.reference}</td>
              <td>USDT {Number(inv.amount_usdt).toFixed(2)}</td>
              <td><span className={`badge ${inv.status === "paid" ? "success" : inv.status === "pending" ? "warning" : "neutral"}`}>{INVOICE_LABEL[inv.status] ?? inv.status}</span></td>
              <td>{new Date(inv.created_at).toLocaleString("pt-BR")}</td>
              <td>{inv.paid_at ? new Date(inv.paid_at).toLocaleString("pt-BR") : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    <section className="card table-card">
      <h2>Lotes de licença</h2>
      {(batches ?? []).length === 0
        ? <p className="muted">Nenhum lote registrado.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Quantidade</th><th>Status</th><th>Início</th><th>Expira em</th></tr></thead>
            <tbody>{(batches ?? []).map((b) => <tr key={b.id}>
              <td>{b.quantity}</td>
              <td><span className={`badge ${b.status === "active" ? "success" : b.status === "pending" ? "warning" : "neutral"}`}>{BATCH_LABEL[b.status] ?? b.status}</span></td>
              <td>{b.starts_at ? new Date(b.starts_at).toLocaleDateString("pt-BR") : "—"}</td>
              <td>{b.expires_at ? new Date(b.expires_at).toLocaleDateString("pt-BR") : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
    </section>
  </Shell>;
}
