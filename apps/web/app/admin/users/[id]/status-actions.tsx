"use client";

import { useState } from "react";
import { updateAccountStatus } from "../actions";

const OPTIONS = [
  { value: "active", label: "Ativo" },
  { value: "inactive", label: "Inativo" },
  { value: "suspended", label: "Suspenso" },
  { value: "blocked", label: "Bloqueado" },
] as const;

export function StatusActions({ userId, currentStatus, currentReason, isSelf }: { userId: string; currentStatus: string; currentReason: string | null; isSelf: boolean }) {
  const [status, setStatus] = useState(currentStatus);
  const [reason, setReason] = useState(currentReason ?? "");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const needsConfirm = status === "suspended" || status === "blocked";
    if (needsConfirm && !window.confirm(`Confirma marcar esta conta como ${OPTIONS.find((o) => o.value === status)?.label}? O acesso do usuário será bloqueado imediatamente.`)) return;
    setPending(true);
    setFeedback(null);
    const result = await updateAccountStatus(userId, status as "active" | "inactive" | "suspended" | "blocked", reason);
    setFeedback(result);
    setPending(false);
  }

  if (isSelf) return <div className="card" style={{ maxWidth: 640 }}><h2>Status da conta</h2><p className="muted">Você não pode alterar o status da própria conta.</p></div>;

  return <form onSubmit={handleSubmit} className="card form-grid" style={{ maxWidth: 640 }}>
    <h2>Status da conta</h2>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {OPTIONS.map((o) => <label key={o.value} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, fontSize: 13, width: "auto" }}>
        <input type="radio" name="status" value={o.value} checked={status === o.value} onChange={() => setStatus(o.value)} style={{ width: "auto" }} /> {o.label}
      </label>)}
    </div>
    <label>Motivo (opcional)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: pagamento em atraso, uso indevido..." /></label>
    <button className="button secondary" type="submit" disabled={pending} style={{ justifySelf: "start" }}>{pending ? "Salvando..." : "Salvar status"}</button>
  </form>;
}
