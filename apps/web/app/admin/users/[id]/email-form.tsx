"use client";

import { useState } from "react";
import { changeUserEmail, changeUsername } from "../actions";

export function EmailForm({ userId, currentEmail, currentUsername }: { userId: string; currentEmail: string; currentUsername: string | null }) {
  const [email, setEmail] = useState(currentEmail);
  const [emailPending, setEmailPending] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [username, setUsername] = useState(currentUsername ?? "");
  const [usernamePending, setUsernamePending] = useState(false);
  const [usernameFeedback, setUsernameFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email.trim().toLowerCase() === currentEmail.toLowerCase()) return;
    if (!window.confirm(`Alterar o e-mail de login de ${currentEmail} para ${email}?`)) return;
    setEmailPending(true);
    setEmailFeedback(null);
    const result = await changeUserEmail(userId, email);
    setEmailFeedback(result);
    setEmailPending(false);
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
      {emailFeedback && <p className={`form-message ${emailFeedback.ok ? "success" : "error"}`}>{emailFeedback.message}</p>}
      <form onSubmit={handleEmailSubmit} className="inline-form">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="button secondary" type="submit" disabled={emailPending || email.trim().toLowerCase() === currentEmail.toLowerCase()}>{emailPending ? "Alterando..." : "Alterar e-mail"}</button>
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
