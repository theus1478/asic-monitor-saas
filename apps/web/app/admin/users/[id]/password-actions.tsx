"use client";

import { useState } from "react";
import { sendTemporaryPasswordByEmail, setTemporaryPassword } from "../actions";

export function PasswordActions({ userId, email }: { userId: string; email: string }) {
  const [mailPending, setMailPending] = useState(false);
  const [mailFeedback, setMailFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [manualPassword, setManualPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [emailIt, setEmailIt] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [manualFeedback, setManualFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function sendTemporary() {
    if (!window.confirm(`Gerar uma senha temporária e enviar para ${email}? A senha atual do usuário deixa de funcionar e ele precisará trocá-la no primeiro acesso.`)) return;
    setMailPending(true);
    setMailFeedback(null);
    setMailFeedback(await sendTemporaryPasswordByEmail(userId));
    setMailPending(false);
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const confirmation = emailIt ? `Definir esta senha e enviá-la por e-mail para ${email}?` : "Definir esta senha agora? O usuário não será avisado — informe a senha a ele.";
    if (!window.confirm(confirmation)) return;
    setManualPending(true);
    setManualFeedback(null);
    const result = await setTemporaryPassword(userId, manualPassword, forceChange, emailIt);
    setManualFeedback(result);
    setManualPending(false);
    if (result.ok) setManualPassword("");
  }

  return <div className="card" style={{ display: "grid", gap: 20, maxWidth: 640 }}>
    <h2>Redefinir senha</h2>
    <div>
      <p className="muted" style={{ fontSize: 13 }}>Gera uma senha aleatória, define no usuário e envia para <b>{email}</b>. No primeiro acesso ele é obrigado a criar uma senha nova.</p>
      {mailFeedback && <p className={`form-message ${mailFeedback.ok ? "success" : "error"}`}>{mailFeedback.message}</p>}
      <button className="button" type="button" disabled={mailPending} onClick={sendTemporary}>{mailPending ? "Enviando..." : "Enviar senha temporária por e-mail"}</button>
    </div>
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      <p className="muted" style={{ fontSize: 13 }}>Ou defina você mesmo a senha do usuário (mín. 8 caracteres).</p>
      {manualFeedback && <p className={`form-message ${manualFeedback.ok ? "success" : "error"}`}>{manualFeedback.message}</p>}
      <form onSubmit={submitManual} className="form-grid">
        <input type="password" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} placeholder="Nova senha" minLength={8} required autoComplete="new-password" />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} /> Exigir troca no próximo login</label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={emailIt} onChange={(e) => setEmailIt(e.target.checked)} /> Enviar esta senha por e-mail ao usuário</label>
        <button className="button secondary" type="submit" disabled={manualPending} style={{ justifySelf: "start" }}>{manualPending ? "Definindo..." : "Definir senha"}</button>
      </form>
    </div>
  </div>;
}
