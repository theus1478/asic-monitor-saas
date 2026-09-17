"use client";

import { useState } from "react";
import { changeUserEmail, changeUsername, requestEmailChangeWithCode } from "../actions";

type Props = { userId: string; currentEmail: string; currentUsername: string | null; pendingEmail: string | null };

export function EmailForm({ userId, currentEmail, currentUsername, pendingEmail }: Props) {
  const [email, setEmail] = useState(currentEmail);
  const [emailPending, setEmailPending] = useState<"confirmed" | "code" | null>(null);
  const [emailFeedback, setEmailFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [username, setUsername] = useState(currentUsername ?? "");
  const [usernamePending, setUsernamePending] = useState(false);
  const [usernameFeedback, setUsernameFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const emailUnchanged = email.trim().toLowerCase() === currentEmail.toLowerCase();

  async function handleEmailSubmit(mode: "confirmed" | "code") {
    if (emailUnchanged) return;
    const confirmMessage = mode === "confirmed"
      ? `Alterar o e-mail de login de ${currentEmail} para ${email} e marcar como confirmado direto?`
      : `Enviar código de confirmação de 6 dígitos para ${email}? O e-mail só muda depois que o usuário confirmar.`;
    if (!window.confirm(confirmMessage)) return;
    setEmailPending(mode);
    setEmailFeedback(null);
    const result = mode === "confirmed" ? await changeUserEmail(userId, email) : await requestEmailChangeWithCode(userId, email);
    setEmailFeedback(result);
    setEmailPending(null);
  }

  async function handleUsernameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUsernamePending(true);
    setUsernameFeedback(null);
    const result = await changeUsername(userId, username);
    setUsernameFeedback(result);
    setUsernamePending(false);
  }

  return <div className="card" style={{ display: "grid", gap: 20, maxWidth: 640 }}>
    <div>
      <h2>E-mail de login</h2>
      {pendingEmail && <p className="form-message warning">Troca pendente para <b>{pendingEmail}</b> — aguardando o usuário confirmar o código de 6 dígitos.</p>}
      {emailFeedback && <p className={`form-message ${emailFeedback.ok ? "success" : "error"}`}>{emailFeedback.message}</p>}
      <form onSubmit={(e) => e.preventDefault()} className="inline-form" style={{ flexWrap: "wrap" }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="button" className="button secondary" disabled={!!emailPending || emailUnchanged} onClick={() => handleEmailSubmit("confirmed")}>
          {emailPending === "confirmed" ? "Alterando..." : "Alterar e marcar como confirmado"}
        </button>
        <button type="button" className="button secondary" disabled={!!emailPending || emailUnchanged} onClick={() => handleEmailSubmit("code")}>
          {emailPending === "code" ? "Enviando..." : "Alterar e exigir confirmação por código"}
        </button>
      </form>
    </div>
    <div>
      <h2>Username</h2>
      {usernameFeedback && <p className={`form-message ${usernameFeedback.ok ? "success" : "error"}`}>{usernameFeedback.message}</p>}
      <form onSubmit={handleUsernameSubmit} className="inline-form">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" required />
        <button className="button secondary" type="submit" disabled={usernamePending}>{usernamePending ? "Salvando..." : "Salvar username"}</button>
      </form>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>3–30 caracteres: letras minúsculas, números, ponto ou underline.</p>
    </div>
  </div>;
}
