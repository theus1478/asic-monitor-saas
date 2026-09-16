"use client";

import { useState } from "react";

export function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // sem permissão de clipboard; o valor já está visível pra copiar manualmente.
    }
  }
  return <button className="button secondary" type="button" onClick={copy}>{copied ? copiedLabel : label}</button>;
}

export function ShareButton({ url, title, label }: { url: string; title: string; label: string }) {
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ url, title });
      } catch {
        // usuário cancelou o compartilhamento nativo; nada a fazer.
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
  }
  return <button className="button" type="button" onClick={share}>{label}</button>;
}
