"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitCode, resendCode } from "./actions";

const LENGTH = 6;

export function OtpForm({ initialCooldownSeconds }: { initialCooldownSeconds: number }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [cooldown, setCooldown] = useState(initialCooldownSeconds);
  const [confirmed, setConfirmed] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => router.push("/dashboard"), 900);
    return () => clearTimeout(timer);
  }, [confirmed, router]);

  function focusIndex(i: number) {
    inputRefs.current[i]?.focus();
  }

  function submit(code: string) {
    if (code.length !== LENGTH || pending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await submitCode(code);
      setFeedback(result);
      if (result.ok) {
        setConfirmed(true);
      } else {
        setDigits(Array(LENGTH).fill(""));
        focusIndex(0);
      }
    });
  }

  function handleChange(i: number, rawValue: string) {
    const digit = rawValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = digit;
    setDigits(next);
    if (digit && i < LENGTH - 1) focusIndex(i + 1);
    if (digit && next.every((d) => d !== "")) submit(next.join(""));
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) focusIndex(i - 1);
    if (e.key === "Enter") { e.preventDefault(); submit(digits.join("")); }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    if (pasted.length === LENGTH) submit(pasted);
    else focusIndex(pasted.length);
  }

  function handleResend() {
    setFeedback(null);
    startTransition(async () => {
      const result = await resendCode();
      setFeedback(result);
      if (result.ok) setCooldown(60);
      else if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
    });
  }

  return <div>
    {feedback && <div className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</div>}
    <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "18px 0" }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={pending || confirmed}
          aria-label={`${t("otpDigitLabel")} ${i + 1}`}
          style={{ width: 44, height: 52, textAlign: "center", fontSize: 22, fontWeight: 700, borderRadius: 9, border: "1px solid #31415a", background: "#0a1018", color: "inherit", outline: "none" }}
        />
      ))}
    </div>
    <button className="button auth-submit" type="button" disabled={pending || confirmed || digits.join("").length !== LENGTH} onClick={() => submit(digits.join(""))}>
      {pending ? t("confirmingEmail") : t("confirmEmailButton")}
    </button>
    <p className="auth-switch">
      {t("noCodeReceived")}{" "}
      <button type="button" disabled={cooldown > 0 || pending || confirmed} onClick={handleResend} style={{ background: "none", border: 0, cursor: cooldown > 0 ? "default" : "pointer", padding: 0, color: cooldown > 0 ? "var(--muted)" : "var(--accent)", fontWeight: 700, font: "inherit" }}>
        {cooldown > 0 ? t("resendCodeIn", { seconds: cooldown }) : t("resendCode")}
      </button>
    </p>
  </div>;
}
