"use client";

import { useState } from "react";
import { updatePlatformRole } from "../actions";

const OPTIONS = [
  { value: "", label: "Usuário comum (sem acesso admin)" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
] as const;

export function RoleForm({ userId, currentRole, isSelf }: { userId: string; currentRole: "super_admin" | "admin" | null; isSelf: boolean }) {
  const [role, setRole] = useState(currentRole ?? "");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  if (isSelf) return <div className="card" style={{ maxWidth: 640 }}><h2>Nível de administrador</h2><p className="muted">Você não pode alterar sua própria permissão de administrador.</p></div>;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Confirma alterar o nível de acesso admin desta conta para "${OPTIONS.find((o) => o.value === role)?.label}"?`)) return;
    setPending(true);
    setFeedback(null);
    const result = await updatePlatformRole(userId, (role || null) as "super_admin" | "admin" | null);
    setFeedback(result);
    setPending(false);
  }

  return <form onSubmit={handleSubmit} className="card form-grid" style={{ maxWidth: 640 }}>
    <h2>Nível de administrador</h2>
    <p className="muted" style={{ fontSize: 13 }}>Só Super Admins podem alterar isso. Não é possível remover o último Super Admin do sistema.</p>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
    <select value={role} onChange={(e) => setRole(e.target.value)} style={{ maxWidth: 320 }}>
      {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <button className="button secondary" type="submit" disabled={pending} style={{ justifySelf: "start" }}>{pending ? "Salvando..." : "Salvar nível de acesso"}</button>
  </form>;
}
