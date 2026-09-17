"use client";

import { useState } from "react";
import { deleteUser, restoreUser } from "../actions";

type Props = {
  userId: string;
  fullName: string | null;
  email: string;
  asicsCount: number;
  farmsCount: number;
  deletedAt: string | null;
  deletedByName: string | null;
  isSelf: boolean;
};

export function DeleteActions({ userId, fullName, email, asicsCount, farmsCount, deletedAt, deletedByName, isSelf }: Props) {
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  if (isSelf) return null;

  async function handleRestore() {
    setPending(true);
    setFeedback(null);
    const result = await restoreUser(userId);
    setFeedback(result);
    setPending(false);
  }

  async function handleDelete() {
    setPending(true);
    setFeedback(null);
    const result = await deleteUser(userId, reason);
    setFeedback(result);
    setPending(false);
    if (result.ok) setConfirmText("");
  }

  if (deletedAt) {
    return <div className="card form-grid" style={{ maxWidth: 640, borderColor: "var(--danger)" }}>
      <h2>Conta excluída</h2>
      {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
      <p className="muted" style={{ fontSize: 13 }}>
        Excluída em {new Date(deletedAt).toLocaleString("pt-BR")}{deletedByName ? ` por ${deletedByName}` : ""}. Os dados da conta foram mantidos — o acesso pode ser restaurado.
      </p>
      <button className="button secondary" type="button" disabled={pending} onClick={handleRestore} style={{ justifySelf: "start" }}>{pending ? "Restaurando..." : "Restaurar conta"}</button>
    </div>;
  }

  return <div className="card form-grid" style={{ maxWidth: 640, borderColor: "var(--danger)" }}>
    <h2>Excluir usuário</h2>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
    <p className="muted" style={{ fontSize: 13 }}>
      Revoga o acesso de <b>{fullName ?? email}</b> ({email}) imediatamente. Esta organização tem <b>{asicsCount} ASIC(s)</b> e <b>{farmsCount} fazenda(s)</b> vinculados — nada disso é apagado, só o acesso da conta é bloqueado. Exclusão reversível (veja &quot;Restaurar conta&quot; depois).
    </p>
    <label>Motivo (opcional)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: solicitação do cliente, conta duplicada..." /></label>
    <label>Digite <code>EXCLUIR</code> para confirmar<input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></label>
    <button className="button" type="button" disabled={pending || confirmText !== "EXCLUIR"} onClick={handleDelete} style={{ justifySelf: "start", background: "var(--danger)", color: "#2b060a" }}>
      {pending ? "Excluindo..." : "Excluir usuário"}
    </button>
  </div>;
}
