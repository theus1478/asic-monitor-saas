"use client";

import { useState } from "react";
import { resendVerificationCode, markEmailConfirmed } from "../actions";

export function VerificationActions({ userId, email, canMarkConfirmed }: { userId: string; email: string; canMarkConfirmed: boolean }) {
  const [pending, setPending] = useState<"resend" | "confirm" | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleResend() {
    setPending("resend");
    setFeedback(null);
    const result = await resendVerificationCode(userId);
    setFeedback(result);
    setPending(null);
  }

  async function handleMarkConfirmed() {
    if (!window.confirm(`Marcar ${email} como confirmado sem exigir o código? Essa ação fica registrada no histórico.`)) return;
    setPending("confirm");
    setFeedback(null);
    const result = await markEmailConfirmed(userId);
    setFeedback(result);
    setPending(null);
  }

  return <div style={{ display: "grid", gap: 8 }}>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
    <div className="inline-form">
      <button className="button secondary compact" type="button" disabled={!!pending} onClick={handleResend}>
        {pending === "resend" ? "Enviando..." : "Reenviar código de confirmação"}
      </button>
      {canMarkConfirmed && <button className="button secondary compact" type="button" disabled={!!pending} onClick={handleMarkConfirmed}>
        {pending === "confirm" ? "Confirmando..." : "Marcar e-mail como confirmado"}
      </button>}
    </div>
  </div>;
}
