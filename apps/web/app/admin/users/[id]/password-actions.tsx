"use client";

import { useState } from "react";
import { resetUserPassword, setTemporaryPassword } from "../actions";

export function PasswordActions({ userId, email }: { userId: string; email: string }) {
  const [linkPending, setLinkPending] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [tempPassword, setTempPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [tempPending, setTempPending] = useState(false);
  const [tempFeedback, setTempFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function sendLink() {
    if (!window.confirm(`Enviar e-mail de redefinição de senha para ${email}?`)) return;
    setLinkPending(true);
    setLinkFeedback(null);
    const result = await resetUserPassword(userId, email);
    setLinkFeedback(result);
    setLinkPending(false);
  }

  async function submitTemp(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("Definir esta senha temporária para o usuário agora? Ele não será notificado automaticamente.")) return;
    setTempPending(true);
    setTempFeedback(null);
    const result = await setTemporaryPassword(userId, tempPassword, forceChange);
    setTempFeedback(result);
    setTempPending(false);
    if (result.ok) setTempPassword("");
  }

  return <div className="card" style={{ display: "grid", gap: 20, maxWidth: 640 }}>
    <h2>Redefinir senha</h2>
    <div>
      <p className="muted" style={{ fontSize: 13 }}>Envia o link padrão de redefinição — o usuário escolhe a própria senha nova. O admin nunca vê a senha do usuário.</p>
      {linkFeedback && <p className={`form-message ${linkFeedback.ok ? "success" : "error"}`}>{linkFeedback.message}</p>}
      <button className="button secondary" type="button" disabled={linkPending} onClick={sendLink}>{linkPending ? "Enviando..." : "Enviar link de redefinição"}</button>
    </div>
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      <p className="muted" style={{ fontSize: 13 }}>Ou defina uma senha temporária manualmente (o usuário deve trocá-la depois de entrar).</p>
      {tempFeedback && <p className={`form-message ${tempFeedback.ok ? "success" : "error"}`}>{tempFeedback.message}</p>}
      <form onSubmit={submitTemp} className="inline-form" style={{ flexWrap: "wrap" }}>
        <input type="password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} placeholder="Senha temporária (mín. 8 caracteres)" minLength={8} required autoComplete="new-password" />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} /> Exigir troca no próximo login</label>
        <button className="button secondary" type="submit" disabled={tempPending}>{tempPending ? "Definindo..." : "Definir senha temporária"}</button>
      </form>
    </div>
  </div>;
}
