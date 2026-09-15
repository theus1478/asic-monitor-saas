"use client";

import { useState } from "react";
import { sendPasswordReset } from "../../user-actions";

export function ResetPasswordButton({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleClick() {
    if (!window.confirm(`Enviar e-mail de redefinição de senha para ${email}?`)) return;
    setPending(true);
    setFeedback(null);
    try {
      const result = await sendPasswordReset(email);
      setFeedback(result);
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : "Falha ao enviar." });
    } finally {
      setPending(false);
    }
  }

  return <div>
    <button className="button secondary" type="button" disabled={pending} onClick={handleClick}>
      {pending ? "Enviando..." : "Enviar redefinição de senha"}
    </button>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
  </div>;
}
