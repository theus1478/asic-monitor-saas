"use client";

import { useState } from "react";
import { updateUserProfile } from "../actions";
import type { PlatformUserDetail } from "../../../../lib/admin/users";

export function ProfileTab({ user }: { user: PlatformUserDetail }) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setFeedback(null);
    const result = await updateUserProfile(user.id, formData);
    setFeedback(result);
    setPending(false);
  }

  return <form action={handleSubmit} className="card form-grid" style={{ maxWidth: 640 }}>
    <h2>Perfil</h2>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
    <label>Nome completo<input name="fullName" defaultValue={user.fullName ?? ""} /></label>
    <label>Telefone<input name="phone" defaultValue={user.phone ?? ""} /></label>
    <label>Empresa<input name="company" defaultValue={user.company ?? ""} /></label>
    <label>Cargo<input name="jobTitle" defaultValue={user.jobTitle ?? ""} /></label>
    <div className="form-grid-cols-2">
      <label>Fuso horário<input name="timezone" defaultValue={user.timezone ?? ""} placeholder="America/Sao_Paulo" /></label>
      <label>País<input name="country" defaultValue={user.country ?? ""} /></label>
    </div>
    <label>Observações administrativas<textarea name="adminNotes" defaultValue={user.adminNotes ?? ""} rows={3} style={{ resize: "vertical" }} /></label>
    <p className="muted" style={{ fontSize: 12 }}>Visível só para administradores da plataforma.</p>
    <button className="button secondary" type="submit" disabled={pending} style={{ justifySelf: "start" }}>{pending ? "Salvando..." : "Salvar perfil"}</button>
  </form>;
}
