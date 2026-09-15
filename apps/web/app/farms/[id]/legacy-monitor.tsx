"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PoolCommandHistory, PoolModal, type PoolCommandSummary } from "./pool-control";

export type Board = { name?: string; chip_temp_c?: number | null; pcb_temp_c?: number | null; hashrate_ths?: number | null };
export type MonitorMiner = {
  id: string; name: string; ip: string; port: number; type: string; online: boolean; observed_at: string | null;
  hashrate_ths?: number | null; hashrate_avg_ths?: number | null; temp_c?: number | null; power_w?: number | null;
  power_estimated?: boolean; efficiency_jth?: number | null; voltage_v?: number | null; current_a?: number | null;
  current_estimated?: boolean; model?: string | null; uptime_s?: number | null; accepted?: number | null; rejected?: number | null;
  pool?: string | null; worker?: string | null; cooling_mode?: string | null; cooling_inferred?: boolean; fans_rpm?: number[];
  boards?: Board[]; error?: string | null;
};
type HistoryPoint = { observedAt: string; hashrate: number; power: number };
type View = "table" | "cards" | "calc";
type SortKey = "name" | "ip" | "type" | "hashrate_ths" | "power_w" | "uptime_s" | "rejected";
const RANGES = [5, 30, 60, 240, 720, 1440];
const TEMPS: Record<string, { warn: number; crit: number }> = { whatsminer: { warn: 95, crit: 100 }, antminer: { warn: 80, crit: 90 }, avalon: { warn: 85, crit: 95 } };
const n = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const hash = (value: unknown) => n(value)?.toFixed(2) ?? "—";
const watts = (value: unknown) => n(value)?.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) ?? "—";
const uptime = (value: unknown) => { const s = n(value); if (!s) return "—"; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const age = (date: string | null) => { if (!date) return "—"; const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min`; };
const tempClass = (type: string, value: unknown) => { const t = n(value); if (t == null) return "lm-t-na"; const l = TEMPS[type] ?? { warn: 80, crit: 90 }; return t >= l.crit ? "lm-t-crit" : t >= l.warn ? "lm-t-warn" : "lm-t-ok"; };

function ThermalStrip({ miner, large }: { miner: MonitorMiner; large?: boolean }) {
  const boards = Array.isArray(miner.boards) ? miner.boards : [];
  if (!boards.length) return <span className="lm-dim lm-mono">—</span>;
  return <div className={`lm-strip ${large ? "lm-lg" : "lm-sm"}`}>{boards.map((board, index) => <div className={`lm-seg ${tempClass(miner.type, board.chip_temp_c)}`} key={`${board.name}-${index}`}><span className="lm-sl">P{index + 1}</span><span className="lm-st">{n(board.chip_temp_c)?.toFixed(0) ?? "—"}{large && "°"}</span></div>)}</div>;
}

function Cooling({ miner, full }: { miner: MonitorMiner; full?: boolean }) {
  if (!miner.cooling_mode) return <span className="lm-dim">—</span>;
  const labels: Record<string, string> = { immersion: "Imersão", air: "Ar", hydro: "Hydro" };
  const css = miner.cooling_mode === "immersion" ? "lm-cool-imm" : miner.cooling_mode === "hydro" ? "lm-cool-hyd" : "lm-cool-air";
  const fans = Array.isArray(miner.fans_rpm) ? miner.fans_rpm : [];
  const rpm = fans.length ? (full ? fans : [Math.max(...fans)]).map((fan) => Math.round(fan).toLocaleString("pt-BR")).join(" / ") : null;
  return <><span className={`lm-cbadge ${css}`}>{miner.cooling_inferred && "≈"}{labels[miner.cooling_mode] ?? miner.cooling_mode}</span>{rpm && <span className="lm-rpm lm-mono"> {rpm} rpm</span>}</>;
}

function VA({ miner }: { miner: MonitorMiner }) {
  if (n(miner.voltage_v) == null && n(miner.current_a) == null) return <span className="lm-dim">—</span>;
  return <>{n(miner.voltage_v) == null ? "—" : `${miner.voltage_v}V`} / {n(miner.current_a) == null ? "—" : `${miner.current_a}A`} {miner.current_estimated && <span className="lm-est">calc</span>}</>;
}

/** Média móvel: acomoda leituras que oscilam por natureza (varredura da rede,
 * arredondamento do firmware) sem esconder uma queda real e sustentada. */
function smooth(values: number[], window = 3): number[] {
  if (values.length <= window) return values;
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function LineChart({ values: raw, color }: { values: number[]; color: string }) {
  if (raw.length < 2) return <div className="lm-empty-chart">Aguardando leituras…</div>;
  const values = smooth(raw);
  const max = Math.max(...values, .001), min = Math.min(...values, 0), range = max - min || 1;
  const points = values.map((value, index) => `${index * (600 / (values.length - 1))},${180 - ((value - min) / range) * 165}`).join(" ");
  return <svg className="lm-chart" viewBox="0 0 600 190" preserveAspectRatio="none"><polyline points={points} style={{ stroke: color }} /></svg>;
}

type PriceQuote = { price: number | null; source: string | null; note: string | null; ok: boolean };

function Calculator({ miners }: { miners: MonitorMiner[] }) {
  const [mode, setMode] = useState<"network" | "flat">("network"), [rate, setRate] = useState(.00056), [btc, setBtc] = useState(350000), [usd, setUsd] = useState(.04), [fee, setFee] = useState(2.8), [bonus, setBonus] = useState(0);
  const [quote, setQuote] = useState<PriceQuote | null>(null), [quoting, setQuoting] = useState(true);
  const applyQuote = () => fetch("/api/btc-price?currency=BRL").then((r) => r.json()).then((data: PriceQuote) => {
    setQuote(data);
    if (data.ok && typeof data.price === "number") setBtc(data.price);
  }).catch(() => setQuote({ price: null, source: null, note: "Falha ao buscar cotação.", ok: false })).finally(() => setQuoting(false));
  const fetchQuote = () => { setQuoting(true); applyQuote(); };
  useEffect(() => { applyQuote(); }, []);
  const online = miners.filter((miner) => miner.online);
  const effective = (miner: MonitorMiner) => (n(miner.hashrate_ths) ?? 0) * (miner.type === "avalon" ? 1 : 1 - fee / 100);
  const th = online.reduce((sum, miner) => sum + effective(miner), 0), dailyBtc = rate * th / 1000, dailyBrl = dailyBtc * btc, dailyUsd = usd * th * (1 + bonus / 100);
  const money = (value: number, currency: "BRL" | "USD") => value.toLocaleString("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 });
  return <section className="lm-calc">
    <div className="lm-panel"><div className="lm-panel-head"><h2>Parâmetros da estimativa</h2><div className="lm-c-mode"><button className={mode === "network" ? "active" : ""} onClick={() => setMode("network")}>Rede (BTC)</button><button className={mode === "flat" ? "active" : ""} onClick={() => setMode("flat")}>US$/TH (Rental Hash)</button></div></div>
      <div className="lm-calc-params">{mode === "network" ? <><label>Rendimento da rede<input type="number" step=".00001" value={rate} onChange={(e) => setRate(+e.target.value)} /><small>BTC / PH/s · dia</small></label><label>Cotação do BTC<input type="number" value={btc} onChange={(e) => setBtc(+e.target.value)} /><small>{quoting ? "buscando…" : quote?.ok ? `${quote.source === "coingecko" ? "CoinGecko" : "API-Ninjas"} · agora` : quote?.note ?? "valor em reais"} · <button type="button" className="lm-quote-refresh" onClick={fetchQuote} disabled={quoting}>atualizar</button></small></label></> : <><label>Quanto vale sua potência<input type="number" step=".001" value={usd} onChange={(e) => setUsd(+e.target.value)} /><small>US$ / TH/s por dia</small></label><label>Bônus no pagamento<select value={bonus} onChange={(e) => setBonus(+e.target.value)}><option value="0">0%</option><option value="5">5%</option><option value="7.5">7,5%</option><option value="10">10%</option></select></label></>}<label>Hashrate<span className="lm-live-value">{th.toFixed(2)} TH/s</span><small>frota online ao vivo</small></label><label>Devfee do firmware<input type="number" step=".1" value={fee} onChange={(e) => setFee(+e.target.value)} /><small>exceto Avalon</small></label></div>
    </div>
    <div className="lm-results">{mode === "network" ? <><Result css="lm-r-btc" label="Rendimento em BTC" value={`${dailyBtc.toFixed(8)} BTC/dia`} sub={`${(dailyBtc * 30).toFixed(8)} BTC/mês`} /><Result css="lm-r-net" label="Líquido/dia" value={`${money(dailyBrl, "BRL")}/dia`} sub={`${money(dailyBrl * 30, "BRL")}/mês`} /></> : <><Result css="lm-r-rev" label="Pagamento / hora" value={`${money(dailyUsd / 24, "USD")}/h`} /><Result css="lm-r-net" label="Pagamento / dia" value={`${money(dailyUsd, "USD")}/dia`} sub={`${money(dailyUsd * 30, "USD")}/mês`} /></>}</div>
    <div className="lm-panel lm-income"><div className="lm-panel-head"><h2>Rendimento por máquina</h2></div><div className="lm-scroll"><table><thead><tr><th>Máquina</th><th>Tipo</th><th>Devfee</th><th>TH/s</th><th>{mode === "network" ? "BTC/dia" : "US$/dia"}</th></tr></thead><tbody>{online.map((miner) => <tr key={miner.id}><td>{miner.name}</td><td><span className="lm-tag">{miner.type}</span></td><td className="lm-dim">{miner.type === "avalon" ? "isento" : `${fee.toFixed(1)}%`}</td><td className="lm-num">{hash(miner.hashrate_ths)}</td><td className="lm-num lm-pos">{mode === "network" ? (rate * effective(miner) / 1000).toFixed(8) : money(usd * effective(miner) * (1 + bonus / 100), "USD")}</td></tr>)}</tbody></table></div></div><p className="lm-note">Estimativa. O rendimento real varia com dificuldade da rede, sorte do pool, taxas e uptime. Mês = 30 dias.</p>
  </section>;
}

function Result({ css, label, value, sub }: { css: string; label: string; value: string; sub?: string }) { return <div className={`lm-result ${css}`}><span>{label}</span><strong>{value}</strong>{sub && <p>{sub}</p>}</div>; }

type RebootResult = { ok: boolean; message: string };

export function LegacyMonitor({ farmId, farmName, timezone, miners, history, poolCommands, addMinerAction, deleteMinerAction, rebootMinerAction, agentPanel }: { farmId: string; farmName: string; timezone: string; miners: MonitorMiner[]; history: HistoryPoint[]; poolCommands: PoolCommandSummary[]; addMinerAction: (formData: FormData) => void | Promise<void>; deleteMinerAction: (minerId: string) => void | Promise<void>; rebootMinerAction: (minerId: string) => Promise<RebootResult>; agentPanel: ReactNode }) {
  const router = useRouter(); const [pending, startTransition] = useTransition();
  const [view, setView] = useState<View>("table"), [range, setRange] = useState(30), [query, setQuery] = useState(""), [type, setType] = useState(""), [status, setStatus] = useState(""), [sortKey, setSortKey] = useState<SortKey>("name"), [direction, setDirection] = useState(1), [selected, setSelected] = useState<MonitorMiner | null>(null), [addOpen, setAddOpen] = useState(false), [setup, setSetup] = useState(false), [poolOpen, setPoolOpen] = useState(false), [poolMinerId, setPoolMinerId] = useState<string | null>(null);
  useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); }, 15000); return () => clearInterval(timer); }, [router]);
  const rows = useMemo(() => miners.filter((miner) => { const hay = `${miner.name} ${miner.ip} ${miner.pool ?? ""} ${miner.model ?? ""}`.toLowerCase(); return (!query || hay.includes(query.toLowerCase())) && (!type || miner.type === type) && (!status || (status === "on") === miner.online); }).sort((a, b) => { const left = a[sortKey], right = b[sortKey]; if (typeof left === "string" && typeof right === "string") return direction * left.localeCompare(right); return direction * ((n(left) ?? -Infinity) - (n(right) ?? -Infinity)); }), [miners, query, type, status, sortKey, direction]);
  const online = miners.filter((miner) => miner.online), totalHash = online.reduce((sum, miner) => sum + (n(miner.hashrate_ths) ?? 0), 0), totalPower = online.reduce((sum, miner) => sum + (n(miner.power_w) ?? 0), 0), latest = miners.map((miner) => miner.observed_at).filter(Boolean).sort().at(-1) ?? null, cutoff = Date.now() - range * 60000, chart = history.filter((point) => new Date(point.observedAt).getTime() >= cutoff);
  const sort = (key: SortKey) => { if (key === sortKey) setDirection(-direction); else { setSortKey(key); setDirection(1); } };
  const th = (label: string, key?: SortKey) => <th onClick={() => key && sort(key)}>{label}{key === sortKey && <span className="lm-ar"> {direction > 0 ? "▲" : "▼"}</span>}</th>;
  const removeMiner = (minerId: string) => startTransition(async () => { await deleteMinerAction(minerId); setSelected(null); router.refresh(); });
  const restartMiner = (minerId: string) => rebootMinerAction(minerId);
  return <div className="legacy-monitor">
    <header className="lm-header"><Link className="lm-brand" href="/dashboard"><img src="/favicon.svg" width="38" height="38" alt="" /><span><b>ASIC</b><em>Monitor</em></span></Link><nav className="lm-viewtoggle"><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Frota</button><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>Cards</button><button className={view === "calc" ? "active" : ""} onClick={() => setView("calc")}>Rendimento</button></nav><div className="lm-status"><span>●</span> {online.length}/{miners.length} online · varredura há {age(latest)}{pending && " · atualizando…"}</div><button className="lm-logout" onClick={() => setSetup(!setup)}>Coletor</button><Link className="lm-logout" href="/farms">Fazendas</Link></header>
    <main className="lm-wrap"><div className="lm-farm"><b>{farmName}</b><span>{timezone}</span></div><section className="lm-kpis"><Kpi css="lm-k-hash" label="Hashrate total" value={totalHash.toFixed(2)} unit="TH/s" /><Kpi css="lm-k-pow" label="Consumo total" value={(totalPower / 1000).toFixed(2)} unit="kW" /><Kpi css="lm-k-eff" label="Eficiência" value={totalHash ? (totalPower / totalHash).toFixed(1) : "—"} unit="J/TH" /><Kpi css="lm-k-on" label="Online" value={`${online.length}`} unit={`/ ${miners.length}`} /><Kpi css="lm-k-off" label="Offline" value={`${miners.length - online.length}`} /></section>
      <section className="lm-charts"><div className="lm-panel"><div className="lm-panel-head"><h2>Hashrate — TH/s</h2><div className="lm-ranges">{RANGES.map((minutes) => <button key={minutes} className={range === minutes ? "active" : ""} onClick={() => setRange(minutes)}>{minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${minutes / 60}h` : "24h"}</button>)}</div></div><LineChart values={chart.map((point) => point.hashrate)} color="#3ddca0" /></div><div className="lm-panel"><div className="lm-panel-head"><h2>Consumo — kW</h2></div><LineChart values={chart.map((point) => point.power / 1000)} color="#5c9cff" /></div></section>
      {view === "calc" ? <Calculator miners={miners} /> : <><div className="lm-bar"><input type="search" placeholder="Filtrar por nome, IP, pool…" value={query} onChange={(e) => setQuery(e.target.value)} /><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos os tipos</option><option value="antminer">Antminer</option><option value="whatsminer">Whatsminer</option><option value="avalon">Avalon</option></select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Online + offline</option><option value="on">Só online</option><option value="off">Só offline</option></select><span /><button className="lm-btn lm-pool-button" onClick={() => { setPoolMinerId(null); setPoolOpen(true); }}>⇄ Trocar pool</button><button className="lm-btn lm-primary" onClick={() => setAddOpen(true)}>+ Adicionar máquina</button><button className="lm-btn" onClick={() => startTransition(() => router.refresh())}>↻ Atualizar</button></div>{view === "table" ? <div className="lm-tablewrap"><div className="lm-scroll"><table><thead><tr>{th("Máquina", "name")}{th("IP", "ip")}{th("Tipo", "type")}{th("TH/s", "hashrate_ths")}{th("Consumo", "power_w")}{th("Tensão / Corrente")}{th("Hashboards °C")}{th("Refrigeração")}{th("Uptime", "uptime_s")}{th("Rej.", "rejected")}</tr></thead><tbody>{rows.length ? rows.map((miner) => <MinerRow key={miner.id} miner={miner} open={() => setSelected(miner)} />) : <tr><td colSpan={10} className="lm-empty">Nenhuma máquina corresponde ao filtro.</td></tr>}</tbody></table></div></div> : <div className="lm-cards">{rows.map((miner) => <MinerCard key={miner.id} miner={miner} open={() => setSelected(miner)} />)}</div>}</>}
      {setup && <section className="lm-setup">{agentPanel}</section>}
      <PoolCommandHistory commands={poolCommands} />
    </main>{(selected || addOpen) && <Modal miner={selected} close={() => { setSelected(null); setAddOpen(false); }} addAction={addMinerAction} changePool={(minerId) => { setSelected(null); setPoolMinerId(minerId); setPoolOpen(true); }} deleteMiner={removeMiner} rebootMiner={restartMiner} />}
    {poolOpen && <PoolModal key={poolMinerId ?? "batch"} farmId={farmId} miners={miners} initialMinerId={poolMinerId} onClose={() => setPoolOpen(false)} />}
  </div>;
}

function Kpi({ css, label, value, unit }: { css: string; label: string; value: string; unit?: string }) { return <div className={`lm-kpi ${css}`}><span>{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong></div>; }
function MinerRow({ miner, open }: { miner: MonitorMiner; open: () => void }) { return <tr onClick={open}><td><span className={`lm-dot ${miner.online ? "lm-on" : "lm-off"}`} /><b>{miner.name}</b></td><td className="lm-num lm-dim"><a className="lm-iplink" href={`http://${miner.ip}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{miner.ip}</a></td><td><span className="lm-tag">{miner.type}</span></td><td className="lm-num">{hash(miner.hashrate_ths)}</td><td className="lm-num">{watts(miner.power_w)} {miner.power_estimated && <span className="lm-est">est</span>}</td><td className="lm-num"><VA miner={miner} /></td><td><ThermalStrip miner={miner} /></td><td><Cooling miner={miner} /></td><td className="lm-num lm-dim">{uptime(miner.uptime_s)}</td><td className={`lm-num ${n(miner.rejected) ? "lm-warm" : "lm-dim"}`}>{n(miner.rejected) ?? 0}</td></tr>; }
function MinerCard({ miner, open }: { miner: MonitorMiner; open: () => void }) { return <article className={`lm-mcard ${miner.online ? "" : "lm-offline"}`} onClick={open}><div className="lm-mc-top"><span className={`lm-dot ${miner.online ? "lm-on" : "lm-off"}`} /><div><b>{miner.name}</b><small>{miner.ip} · {miner.model ?? miner.type}</small></div><span className="lm-tag">{miner.type}</span></div><div className="lm-mc-metrics"><div><span>Hashrate</span><strong>{hash(miner.hashrate_ths)}<small> TH/s</small></strong></div><div><span>Consumo</span><strong>{watts(miner.power_w)}<small> W</small></strong></div></div><p className="lm-strip-label">Hashboards °C</p><ThermalStrip miner={miner} large /><div className="lm-card-cooling"><Cooling miner={miner} /></div><footer><VA miner={miner} /><span>{uptime(miner.uptime_s)}</span><span>rej {n(miner.rejected) ?? 0}</span></footer></article>; }
function Modal({ miner, close, addAction, changePool, deleteMiner, rebootMiner }: { miner: MonitorMiner | null; close: () => void; addAction: (formData: FormData) => void | Promise<void>; changePool: (minerId: string) => void; deleteMiner: (minerId: string) => void; rebootMiner: (minerId: string) => Promise<RebootResult> }) {
  const [rebooting, setRebooting] = useState(false);
  const [rebootFeedback, setRebootFeedback] = useState<RebootResult | null>(null);
  const doReboot = async () => {
    if (!miner) return;
    setRebooting(true); setRebootFeedback(null);
    const result = await rebootMiner(miner.id);
    setRebootFeedback(result); setRebooting(false);
  };
  const doDelete = () => { if (miner && window.confirm(`Excluir a máquina "${miner.name}"? Essa ação não pode ser desfeita.`)) deleteMiner(miner.id); };
  return <div className="lm-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}><div className="lm-modal"><button className="lm-close" onClick={close}>×</button>{miner ? <><h3>{miner.name}</h3><p className="lm-sub">{miner.type} · {miner.ip}:{miner.port} · {miner.online ? "online" : "OFFLINE"}{miner.error && ` · ${miner.error}`}</p><div className="lm-kv"><Detail label="Modelo" value={miner.model ?? "—"} /><Detail label="Hashrate atual" value={`${hash(miner.hashrate_ths)} TH/s`} /><Detail label="Hashrate médio" value={`${hash(miner.hashrate_avg_ths)} TH/s`} /><Detail label="Consumo" value={`${watts(miner.power_w)} W`} /><Detail label="Tensão / Corrente" value={<VA miner={miner} />} /><Detail label="Eficiência" value={`${n(miner.efficiency_jth)?.toFixed(1) ?? "—"} J/TH`} /><Detail label="Refrigeração" value={<Cooling miner={miner} full />} /><Detail label="Uptime" value={uptime(miner.uptime_s)} /><Detail label="Shares aceitas" value={`${n(miner.accepted) ?? 0}`} /><Detail label="Shares rejeitadas" value={`${n(miner.rejected) ?? 0}`} /><Detail label="Pool" value={miner.pool ?? "—"} /><Detail label="Worker" value={miner.worker ?? "—"} /></div><h4>Temperatura por hashboard</h4><ThermalStrip miner={miner} large />
    {rebootFeedback && <p className={`lm-command-feedback ${rebootFeedback.ok ? "ok" : "error"}`}>{rebootFeedback.message}</p>}
    <div className="lm-detail-actions"><button className="lm-btn lm-pool-button" onClick={() => changePool(miner.id)}>⇄ Trocar pool desta máquina</button><button className="lm-btn" disabled={rebooting} onClick={doReboot}>{rebooting ? "Reiniciando…" : "⟲ Reiniciar máquina"}</button><button className="lm-btn lm-danger" onClick={doDelete}>🗑 Excluir máquina</button></div></> : <><h3>Adicionar máquina</h3><p className="lm-sub">a próxima varredura já inclui o dispositivo</p><form action={addAction} onSubmit={close}><label>Nome<input name="name" required placeholder="ex: ASIC-01" /></label><label>IP<input name="ip" required placeholder="192.168.1.101" /></label><label>Tipo<select name="type" defaultValue="antminer"><option value="antminer">Antminer</option><option value="whatsminer">Whatsminer</option><option value="avalon">Avalon</option></select></label><label>Porta<input name="port" type="number" defaultValue="4028" /></label><button className="lm-btn lm-primary" type="submit">Adicionar</button></form></>}</div></div>;
}
function Detail({ label, value }: { label: string; value: ReactNode }) { return <div><span>{label}</span><b>{value}</b></div>; }
