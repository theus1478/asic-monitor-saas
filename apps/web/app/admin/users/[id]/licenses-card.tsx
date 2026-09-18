"use client";

import { useState } from "react";
import { grantManualLicenses, revokeLicenseBatch } from "../license-actions";

export type LicenseBatchRow = { id: string; organization_id: string; quantity: number; status: string; starts_at: string | null; expires_at: string | null; has_invoice: boolean };
export type LicenseOrg = { id: string; name: string; activeQuantity: number; machines: number; batches: LicenseBatchRow[] };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

const nowMs = () => Date.now();

// Fim do dia no horário de Brasília — "válida até 30/10" significa até o fim do dia 30.
const endOfDay = (date: string) => new Date(`${date}T23:59:59-03:00`).toISOString();

export function LicensesCard({ userId, orgs }: { userId: string; orgs: LicenseOrg[] }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [quantity, setQuantity] = useState("10");
  const [days, setDays] = useState("30");
  const [untilDate, setUntilDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  if (orgs.length === 0) return <div className="card" style={{ maxWidth: 900 }}><h2>Licenças</h2><p className="muted">Este usuário não pertence a nenhuma organização.</p></div>;

  const expiresAt = untilDate ? endOfDay(untilDate) : new Date(nowMs() + Math.max(0, Number(days) || 0) * 86400_000).toISOString();

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    const org = orgs.find((o) => o.id === orgId);
    const when = untilDate ? `até ${new Date(expiresAt).toLocaleDateString("pt-BR")}` : `por ${days} dia(s) (até ${new Date(expiresAt).toLocaleDateString("pt-BR")})`;
    if (!window.confirm(`Conceder ${quantity} licença(s) a "${org?.name}" ${when}?`)) return;
    setPending(true); setFeedback(null);
    setFeedback(await grantManualLicenses(userId, orgId, Number(quantity), expiresAt, note));
    setPending(false);
  }

  async function revoke(batch: LicenseBatchRow) {
    const reason = window.prompt(`Encerrar agora o lote de ${batch.quantity} licença(s) (válido até ${fmt(batch.expires_at)})? Motivo (opcional):`);
    if (reason === null) return;
    setPending(true); setFeedback(null);
    setFeedback(await revokeLicenseBatch(userId, batch.id, reason));
    setPending(false);
  }

  return <div className="card" style={{ maxWidth: 900, display: "grid", gap: 18 }}>
    <div><h2>Licenças</h2><p className="muted" style={{ fontSize: 13 }}>Concede licenças manualmente (cortesia/parceria) sem fatura. Só Super Admins. Cada ação fica registrada no histórico de auditoria.</p></div>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}

    {orgs.map((org) => <div key={org.id} style={{ display: "grid", gap: 8 }}>
      <div className="inline-form" style={{ gap: 10 }}>
        <b>{org.name}</b>
        <span className="badge success">{org.activeQuantity} licença(s) ativa(s)</span>
        <span className="badge neutral">{org.machines} máquina(s) cadastrada(s)</span>
      </div>
      {org.batches.length === 0 ? <p className="muted">Nenhum lote de licença ainda.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Quantidade</th><th>Situação</th><th>Início</th><th>Validade</th><th>Origem</th><th /></tr></thead>
        <tbody>{org.batches.map((batch) => {
          const expired = batch.status === "active" && batch.expires_at && new Date(batch.expires_at).getTime() <= nowMs();
          const label = expired ? "Expirado" : batch.status === "active" ? "Ativo" : batch.status === "pending" ? "Pendente" : batch.status === "cancelled" ? "Encerrado" : "Expirado";
          const tone = label === "Ativo" ? "success" : label === "Pendente" ? "warning" : "neutral";
          return <tr key={batch.id}>
            <td>{batch.quantity}</td>
            <td><span className={`badge ${tone}`}>{label}</span></td>
            <td>{fmt(batch.starts_at)}</td>
            <td>{fmt(batch.expires_at)}</td>
            <td>{batch.has_invoice ? "Fatura" : "Manual / gratuita"}</td>
            <td>{label === "Ativo" && <button type="button" className="button secondary" disabled={pending} onClick={() => revoke(batch)}>Encerrar</button>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </div>)}

    <form onSubmit={grant} className="form-grid" style={{ borderTop: "1px solid var(--border, #2a3a33)", paddingTop: 16 }}>
      <h3 style={{ margin: 0 }}>Adicionar licenças</h3>
      {orgs.length > 1 && <label>Organização<select value={orgId} onChange={(e) => setOrgId(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      <div className="inline-form" style={{ gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label>Quantidade<input type="number" min="1" max="100000" value={quantity} onChange={(e) => setQuantity(e.target.value)} required style={{ maxWidth: 140 }} /></label>
        <label>Validade em dias<input type="number" min="1" max="7300" value={days} onChange={(e) => setDays(e.target.value)} disabled={Boolean(untilDate)} style={{ maxWidth: 140 }} /></label>
        <label>…ou válida até (data)<input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} style={{ maxWidth: 190 }} /></label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Vence em <b>{new Date(expiresAt).toLocaleDateString("pt-BR")}</b>{untilDate ? " (fim do dia, horário de Brasília)" : ""}. Apague a data para voltar a usar dias.</p>
      <label>Observação (opcional, vai para o histórico)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ex.: cortesia parceiro X" /></label>
      <button className="button" type="submit" disabled={pending || !orgId} style={{ justifySelf: "start" }}>{pending ? "Salvando..." : "Conceder licenças"}</button>
    </form>
  </div>;
}
