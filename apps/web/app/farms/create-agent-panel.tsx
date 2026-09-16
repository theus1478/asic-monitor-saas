"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createAgent } from "./actions";

type Agent = { id: string; name: string; status: string; last_seen_at: string | null; is_online?: boolean };

export function CreateAgentPanel({ farmId, agents }: { farmId: string; agents: Agent[] }) {
  const t = useTranslations("createAgent");
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("Telemetria principal");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  const apiUrl = typeof window !== "undefined" ? `${window.location.origin}/api/agent/metrics` : "/api/agent/metrics";

  async function handleCreate() {
    setPending(true);
    setError(null);
    try {
      const created = await createAgent(farmId, name);
      setToken(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  async function copyValue(value: string, label: "url" | "token") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // sem permissão de clipboard; o valor já está visível para cópia manual.
    }
  }

  return <section className="card setup">
    <p className="eyebrow">{t("eyebrow")}</p>
    <h2>{t("title")}</h2>
    {agents.length === 0
      ? <p className="muted">{t("noAgentsYet")}</p>
      : <ul className="agent-list">
          {agents.map((a) => <li key={a.id}>
            <span className={`status-dot ${a.is_online ? "" : "off"}`} /> {a.name} — {a.is_online ? t("onlineStatus") : t("offlineStatus")}
            {a.last_seen_at ? ` · ${t("lastContact", { date: new Date(a.last_seen_at).toLocaleString() })}` : ""}
          </li>)}
        </ul>}

    {token ? (
      <div className="token-reveal">
        <p className="form-message warning"><b>{t("copyNowWarning")}</b></p>
        <p className="muted">{t("instructions")}</p>
        <p className="muted">{t("apiUrlLabel")}</p>
        <code className="token-code">{apiUrl}</code>
        <button className="button secondary" type="button" onClick={() => copyValue(apiUrl, "url")}>{copied === "url" ? t("copied") : t("copyUrl")}</button>
        <p className="muted">{t("agentTokenLabel")}</p>
        <code className="token-code">{token}</code>
        <button className="button secondary" type="button" onClick={() => copyValue(token, "token")}>{copied === "token" ? t("copied") : t("copyToken")}</button>
        <small className="muted">{t("smartScreenNote")}</small>
      </div>
    ) : (
      <div className="inline-form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("agentNamePlaceholder")} />
        <button className="button secondary" type="button" disabled={pending} onClick={handleCreate}>
          {pending ? t("generatingToken") : t("generateToken")}
        </button>
      </div>
    )}
    {error && <p className="form-message error">{error}</p>}
    <a className="text-link" href="/downloads/ASICMonitorAgent.exe" download>{t("downloadCollector")}</a>
  </section>;
}
