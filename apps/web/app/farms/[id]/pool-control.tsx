"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPoolCommand } from "./pool-actions";
import type { MonitorMiner } from "./legacy-monitor";

export type PoolCommandSummary = {
  id: string;
  kind: string;
  pool_url: string | null;
  target_count: number;
  status: string;
  created_at: string;
  result: { successes?: number; failures?: number; results?: { name: string; success: boolean; message: string }[] } | null;
};

const DEFAULTS: Record<string, { username: string; password: string }> = {
  avalon: { username: "root", password: "root" },
  antminer: { username: "admin", password: "admin" },
  whatsminer: { username: "admin", password: "admin" },
};

type PoolDraft = { url: string; worker: string; password: string };
const blankPools = (): PoolDraft[] => [{ url: "", worker: "", password: "x" }, { url: "", worker: "", password: "x" }, { url: "", worker: "", password: "x" }];

export function PoolModal({ farmId, miners, initialMinerId, onClose }: { farmId: string; miners: MonitorMiner[]; initialMinerId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = initialMinerId ? miners.find((miner) => miner.id === initialMinerId) : null;
  const [selected, setSelected] = useState<string[]>(initial ? [initial.id] : miners.map((miner) => miner.id));
  const [pools, setPools] = useState<PoolDraft[]>(blankPools);
  const [useDefaults, setUseDefaults] = useState(!initial);
  const [username, setUsername] = useState(initial ? (DEFAULTS[initial.type]?.username ?? "admin") : "");
  const [password, setPassword] = useState(initial ? (DEFAULTS[initial.type]?.password ?? "admin") : "");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const setPool = (index: number, key: keyof PoolDraft, value: string) => setPools((current) => current.map((pool, idx) => idx === index ? { ...pool, [key]: value } : pool));
  const submit = () => startTransition(async () => {
    const result = await createPoolCommand(farmId, { minerIds: selected, pools, useDefaults, username, password });
    setFeedback(result);
    if (result.ok) router.refresh();
  });
  const allSelected = miners.length > 0 && selected.length === miners.length;

  return <div className="lm-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="lm-modal lm-pool-modal">
      <button className="lm-close" onClick={onClose} aria-label="Fechar">×</button>
      <span className="lm-eyebrow">CONTROLE DA FARM</span>
      <h3>{initialMinerId ? "Trocar pool da máquina" : "Trocar pool em lote"}</h3>
      <p className="lm-sub">O coletor aplica a configuração diretamente nas ASICs selecionadas.</p>

      <div className="lm-pool-grid">
        <section>
          <div className="lm-pool-title"><b>Máquinas</b><button type="button" onClick={() => setSelected(allSelected ? [] : miners.map((miner) => miner.id))}>{allSelected ? "Limpar" : "Selecionar todas"}</button></div>
          <div className="lm-miner-checks">
            {miners.map((miner) => <label key={miner.id}>
              <input type="checkbox" checked={selected.includes(miner.id)} onChange={() => setSelected((current) => current.includes(miner.id) ? current.filter((id) => id !== miner.id) : [...current, miner.id])} />
              <span className={`lm-dot ${miner.online ? "lm-on" : "lm-off"}`} /><span><b>{miner.name}</b><small>{miner.ip} · {miner.type}</small></span>
            </label>)}
          </div>
          <small className="lm-selection-count">{selected.length} de {miners.length} selecionada(s)</small>
        </section>

        <section className="lm-pool-fields">
          {[0, 1, 2].map((index) => <fieldset key={index}>
            <legend>Pool {index + 1}{index === 0 ? " · principal" : " · reserva"}</legend>
            <label>URL<input value={pools[index].url} onChange={(event) => setPool(index, "url", event.target.value)} placeholder="stratum+tcp://pool.exemplo.com:3333" /></label>
            <div><label>Worker<input value={pools[index].worker} onChange={(event) => setPool(index, "worker", event.target.value)} placeholder="carteira.worker" /></label><label>Senha da pool<input value={pools[index].password} onChange={(event) => setPool(index, "password", event.target.value)} placeholder="x" /></label></div>
          </fieldset>)}
        </section>
      </div>

      <section className="lm-credentials">
        <div><b>Acesso às máquinas</b><small>Usado somente pelo coletor durante esta alteração.</small></div>
        <label className="lm-switch"><input type="checkbox" checked={useDefaults} onChange={(event) => setUseDefaults(event.target.checked)} /><span />Padrões por fabricante</label>
        {useDefaults ? <p>Avalon: root/root · Antminer e Whatsminer: admin/admin</p> : <div className="lm-credential-fields"><label>Usuário<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div>}
      </section>

      {feedback && <p className={`lm-command-feedback ${feedback.ok ? "ok" : "error"}`}>{feedback.message}</p>}
      <div className="lm-modal-actions"><button className="lm-btn" onClick={onClose}>Cancelar</button><button className="lm-btn lm-primary" disabled={pending || !selected.length} onClick={submit}>{pending ? "Enviando…" : `Aplicar em ${selected.length} máquina(s)`}</button></div>
    </div>
  </div>;
}

const STATUS: Record<string, string> = { pending: "Aguardando coletor", processing: "Aplicando", succeeded: "Concluído", partial: "Concluído parcialmente", failed: "Falhou", expired: "Expirou" };

export function PoolCommandHistory({ commands }: { commands: PoolCommandSummary[] }) {
  if (!commands.length) return null;
  return <section className="lm-panel lm-command-history">
    <div className="lm-panel-head"><div><span className="lm-eyebrow">AUTOMAÇÃO</span><h2>Comandos enviados</h2></div><small>últimos comandos</small></div>
    <div className="lm-command-list">{commands.map((command) => <details key={command.id}>
      <summary><span className={`lm-command-status ${command.status}`}>{STATUS[command.status] ?? command.status}</span><b>{command.kind === "reboot" ? "⟲ Reinício" : command.pool_url}</b><span>{command.target_count} máquina(s)</span><time>{new Date(command.created_at).toLocaleString("pt-BR")}</time></summary>
      {command.result?.results?.length ? <div className="lm-command-results">{command.result.results.map((result, index) => <p key={`${result.name}-${index}`}><span className={`lm-dot ${result.success ? "lm-on" : "lm-off"}`} /><b>{result.name}</b><span>{result.message}</span></p>)}</div> : <p className="lm-command-wait">O resultado aparecerá quando o coletor processar o comando.</p>}
    </details>)}</div>
  </section>;
}
