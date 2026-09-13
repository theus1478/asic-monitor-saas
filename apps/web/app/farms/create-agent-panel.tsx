"use client";

import { useState } from "react";
import { createAgent } from "./actions";

type Agent = { id: string; name: string; status: string; last_seen_at: string | null };

export function CreateAgentPanel({ farmId, agents }: { farmId: string; agents: Agent[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("Coletor principal");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiUrl = typeof window !== "undefined" ? `${window.location.origin}/api/agent/metrics` : "/api/agent/metrics";
  const command = token
    ? `powershell -ExecutionPolicy Bypass -File .\\install-asic-monitor-agent.ps1 -ApiUrl "${apiUrl}" -AgentToken "${token}"`
    : "";

  async function handleCreate() {
    setPending(true);
    setError(null);
    try {
      const created = await createAgent(farmId, name);
      setToken(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o token.");
    } finally {
      setPending(false);
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // sem permissão de clipboard; o comando já está visível para cópia manual.
    }
  }

  return <section className="card setup">
    <p className="eyebrow">COLETOR DA FAZENDA</p>
    <h2>Instale o coletor nesta fazenda</h2>
    {agents.length === 0
      ? <p className="muted">Nenhum agente ativado nesta fazenda ainda.</p>
      : <ul className="agent-list">
          {agents.map((a) => <li key={a.id}>
            <span className={`status-dot ${a.status === "online" ? "" : "off"}`} /> {a.name} — {a.status}
            {a.last_seen_at ? ` · último contato ${new Date(a.last_seen_at).toLocaleString("pt-BR")}` : ""}
          </li>)}
        </ul>}

    {token ? (
      <div className="token-reveal">
        <p className="form-message warning"><b>Copie agora — este token não será mostrado novamente.</b></p>
        <code className="token-code">{token}</code>
        <p className="muted">Rode este comando na fazenda, na pasta onde salvou o instalador:</p>
        <code className="cmd-block">{command}</code>
        <button className="button secondary" type="button" onClick={copyCommand}>{copied ? "Copiado!" : "Copiar comando"}</button>
      </div>
    ) : (
      <div className="inline-form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do agente" />
        <button className="button secondary" type="button" disabled={pending} onClick={handleCreate}>
          {pending ? "Gerando..." : "Gerar token do agente"}
        </button>
      </div>
    )}
    {error && <p className="form-message error">{error}</p>}
    <a className="text-link" href="/downloads/install-asic-monitor-agent.ps1" download>Baixar instalador (.ps1)</a>
  </section>;
}
