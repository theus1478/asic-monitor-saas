"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
  boards?: Board[]; error?: string | null; licensed?: boolean;
};
type HistoryPoint = { observedAt: string; hashrate: number; power: number };
type View = "table" | "cards" | "calc";
type SortKey = "name" | "ip" | "type" | "hashrate_ths" | "power_w" | "uptime_s" | "rejected";
const RANGES = [5, 30, 60, 240, 720, 1440];
const TEMPS: Record<string, { warn: number; crit: number }> = { whatsminer: { warn: 95, crit: 100 }, antminer: { warn: 80, crit: 90 }, avalon: { warn: 85, crit: 95 } };
const n = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const hash = (value: unknown) => n(value)?.toFixed(2) ?? "—";
const watts = (value: unknown, locale?: string) => n(value)?.toLocaleString(locale, { maximumFractionDigits: 0 }) ?? "—";
const uptime = (value: unknown) => { const s = n(value); if (!s) return "—"; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const age = (date: string | null) => { if (!date) return "—"; const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min`; };
const tempClass = (type: string, value: unknown) => { const t = n(value); if (t == null) return "lm-t-na"; const l = TEMPS[type] ?? { warn: 80, crit: 90 }; return t >= l.crit ? "lm-t-crit" : t >= l.warn ? "lm-t-warn" : "lm-t-ok"; };

function ThermalStrip({ miner, large }: { miner: MonitorMiner; large?: boolean }) {
  const boards = Array.isArray(miner.boards) ? miner.boards : [];
  if (!boards.length) return <span className="lm-dim lm-mono">—</span>;
  return <div className={`lm-strip ${large ? "lm-lg" : "lm-sm"}`}>{boards.map((board, index) => <div className={`lm-seg ${tempClass(miner.type, board.chip_temp_c)}`} key={`${board.name}-${index}`}><span className="lm-sl">P{index + 1}</span><span className="lm-st">{n(board.chip_temp_c)?.toFixed(0) ?? "—"}{large && "°"}</span></div>)}</div>;
}

function Cooling({ miner, full }: { miner: MonitorMiner; full?: boolean }) {
  const t = useTranslations("farmDetail");
  const locale = useLocale();
  if (!miner.cooling_mode) return <span className="lm-dim">—</span>;
  const labels: Record<string, string> = { immersion: t("coolingImmersion"), air: t("coolingAir"), hydro: t("coolingHydro") };
  const css = miner.cooling_mode === "immersion" ? "lm-cool-imm" : miner.cooling_mode === "hydro" ? "lm-cool-hyd" : "lm-cool-air";
  const fans = Array.isArray(miner.fans_rpm) ? miner.fans_rpm : [];
  const rpm = fans.length ? (full ? fans : [Math.max(...fans)]).map((fan) => Math.round(fan).toLocaleString(locale)).join(" / ") : null;
  return <><span className={`lm-cbadge ${css}`}>{miner.cooling_inferred && "≈"}{labels[miner.cooling_mode] ?? miner.cooling_mode}</span>{rpm && <span className="lm-rpm lm-mono"> {rpm} rpm</span>}</>;
}

function VA({ miner }: { miner: MonitorMiner }) {
  const t = useTranslations("farmDetail");
  if (n(miner.voltage_v) == null && n(miner.current_a) == null) return <span className="lm-dim">—</span>;
  return <>{n(miner.voltage_v) == null ? "—" : `${miner.voltage_v}V`} / {n(miner.current_a) == null ? "—" : `${miner.current_a}A`} {miner.current_estimated && <span className="lm-est">{t("estimatedTag")}</span>}</>;
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
  const t = useTranslations("farmDetail");
  if (raw.length < 2) return <div className="lm-empty-chart">{t("awaitingReadings")}</div>;
  const values = smooth(raw);
  const max = Math.max(...values, .001), min = Math.min(...values, 0), range = max - min || 1;
  const points = values.map((value, index) => `${index * (600 / (values.length - 1))},${180 - ((value - min) / range) * 165}`).join(" ");
  return <svg className="lm-chart" viewBox="0 0 600 190" preserveAspectRatio="none"><polyline points={points} style={{ stroke: color }} /></svg>;
}

type PriceQuote = { price: number | null; source: string | null; note: string | null; ok: boolean };
type FxQuote = { usd_brl: number | null };

function Calculator({ miners }: { miners: MonitorMiner[] }) {
  const t = useTranslations("farmDetail");
  const locale = useLocale();
  const [mode, setMode] = useState<"network" | "flat">("network"), [rate, setRate] = useState(.00056), [btc, setBtc] = useState(350000), [usd, setUsd] = useState(.04), [fee, setFee] = useState(2.8), [bonus, setBonus] = useState(0);
  const [quote, setQuote] = useState<PriceQuote | null>(null), [quoting, setQuoting] = useState(true);
  const [usdBrl, setUsdBrl] = useState<number | null>(null), [fxQuoting, setFxQuoting] = useState(true);
  const applyQuote = () => fetch("/api/btc-price?currency=BRL").then((r) => r.json()).then((data: PriceQuote) => {
    setQuote(data);
    if (data.ok && typeof data.price === "number") setBtc(data.price);
  }).catch(() => setQuote({ price: null, source: null, note: t("poolFailedQuote"), ok: false })).finally(() => setQuoting(false));
  const fetchQuote = () => { setQuoting(true); applyQuote(); };
  const applyFx = () => fetch("/api/usd-brl").then((r) => r.json()).then((data: FxQuote) => setUsdBrl(data.usd_brl)).catch(() => setUsdBrl(null)).finally(() => setFxQuoting(false));
  const fetchFx = () => { setFxQuoting(true); applyFx(); };
  useEffect(() => { applyQuote(); applyFx(); }, []);
  const online = miners.filter((miner) => miner.online);
  const effective = (miner: MonitorMiner) => (n(miner.hashrate_ths) ?? 0) * (miner.type === "avalon" ? 1 : 1 - fee / 100);
  const th = online.reduce((sum, miner) => sum + effective(miner), 0), dailyBtc = rate * th / 1000, dailyBrl = dailyBtc * btc, dailyUsd = usd * th * (1 + bonus / 100);
  const money = (value: number, currency: "BRL" | "USD") => value.toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 2 });
  const brlEquivalent = (usdValue: number) => usdBrl != null ? ` (${money(usdValue * usdBrl, "BRL")})` : "";
  return <section className="lm-calc">
    <div className="lm-panel"><div className="lm-panel-head"><h2>{t("calcParamsTitle")}</h2><div className="lm-c-mode"><button className={mode === "network" ? "active" : ""} onClick={() => setMode("network")}>{t("calcModeNetwork")}</button><button className={mode === "flat" ? "active" : ""} onClick={() => setMode("flat")}>{t("calcModeFlat")}</button></div></div>
      <div className="lm-calc-params">{mode === "network" ? <><label>{t("networkYield")}<input type="number" step=".00001" value={rate} onChange={(e) => setRate(+e.target.value)} /><small>{t("btcPerPhPerDay")}</small></label><label>{t("btcQuote")}<input type="number" value={btc} onChange={(e) => setBtc(+e.target.value)} /><small>{quoting ? t("fetching") : quote?.ok ? `${quote.source === "coingecko" ? "CoinGecko" : "API-Ninjas"} ${t("quoteNow")}` : quote?.note ?? t("reaisValue")} · <button type="button" className="lm-quote-refresh" onClick={fetchQuote} disabled={quoting}>{t("refreshQuote")}</button></small></label></> : <><label>{t("powerWorth")}<input type="number" step=".001" value={usd} onChange={(e) => setUsd(+e.target.value)} /><small>{t("usdPerThPerDay")}</small></label><label>{t("paymentBonus")}<select value={bonus} onChange={(e) => setBonus(+e.target.value)}><option value="0">0%</option><option value="5">5%</option><option value="7.5">7,5%</option><option value="10">10%</option></select></label><label>{t("exchangeRate")}<span className="lm-live-value">{fxQuoting ? t("fetching") : usdBrl != null ? `R$ ${usdBrl.toFixed(4)}` : t("unavailable")}</span><small>CoinGecko · <button type="button" className="lm-quote-refresh" onClick={fetchFx} disabled={fxQuoting}>{t("refreshQuote")}</button></small></label></>}<label>{t("hashrateLabel")}<span className="lm-live-value">{th.toFixed(2)} TH/s</span><small>{t("hashrateOnlineLive")}</small></label><label>{t("firmwareDevfee")}<input type="number" step=".1" value={fee} onChange={(e) => setFee(+e.target.value)} /><small>{t("exceptAvalon")}</small></label></div>
    </div>
    <div className="lm-results">{mode === "network" ? <><Result css="lm-r-btc" label={t("btcYield")} value={`${dailyBtc.toFixed(8)} BTC/dia`} sub={`${(dailyBtc * 30).toFixed(8)} BTC/mês`} /><Result css="lm-r-net" label={t("netPerDay")} value={`${money(dailyBrl, "BRL")}/dia`} sub={`${money(dailyBrl * 30, "BRL")}/mês`} /></> : <><Result css="lm-r-rev" label={t("paymentPerHour")} value={`${money(dailyUsd / 24, "USD")}/h${brlEquivalent(dailyUsd / 24)}`} /><Result css="lm-r-net" label={t("paymentPerDay")} value={`${money(dailyUsd, "USD")}/dia${brlEquivalent(dailyUsd)}`} sub={`${money(dailyUsd * 30, "USD")}/mês${brlEquivalent(dailyUsd * 30)}`} /></>}</div>
    <div className="lm-panel lm-income"><div className="lm-panel-head"><h2>{t("incomePerMachine")}</h2></div><div className="lm-scroll"><table><thead><tr><th>{t("colMachine2")}</th><th>{t("colType2")}</th><th>{t("colDevfee")}</th><th>TH/s</th><th>{mode === "network" ? "BTC/dia" : "US$/dia"}</th>{mode === "flat" && <th>R$/dia</th>}</tr></thead><tbody>{online.map((miner) => { const usdPerDay = usd * effective(miner) * (1 + bonus / 100); return <tr key={miner.id}><td>{miner.name}</td><td><span className="lm-tag">{miner.type}</span></td><td className="lm-dim">{miner.type === "avalon" ? t("exempt") : `${fee.toFixed(1)}%`}</td><td className="lm-num">{hash(miner.hashrate_ths)}</td><td className="lm-num lm-pos">{mode === "network" ? (rate * effective(miner) / 1000).toFixed(8) : money(usdPerDay, "USD")}</td>{mode === "flat" && <td className="lm-num lm-dim">{usdBrl != null ? money(usdPerDay * usdBrl, "BRL") : "—"}</td>}</tr>; })}</tbody></table></div></div><p className="lm-note">{t("estimateNote")}</p>
  </section>;
}

function Result({ css, label, value, sub }: { css: string; label: string; value: string; sub?: string }) { return <div className={`lm-result ${css}`}><span>{label}</span><strong>{value}</strong>{sub && <p>{sub}</p>}</div>; }

type RebootResult = { ok: boolean; message: string };

export function LegacyMonitor({ farmId, farmName, timezone, miners, history, poolCommands, addMinerAction, deleteMinerAction, rebootMinerAction, agentPanel }: { farmId: string; farmName: string; timezone: string; miners: MonitorMiner[]; history: HistoryPoint[]; poolCommands: PoolCommandSummary[]; addMinerAction: (formData: FormData) => void | Promise<void>; deleteMinerAction: (minerId: string) => void | Promise<void>; rebootMinerAction: (minerId: string) => Promise<RebootResult>; agentPanel: ReactNode }) {
  const t = useTranslations("farmDetail");
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
    <header className="lm-header"><Link className="lm-brand" href="/dashboard"><img src="/favicon.svg" width="38" height="38" alt="" /><span><b>ASIC</b><em>Monitor</em></span></Link><nav className="lm-viewtoggle"><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>{t("fleet")}</button><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>{t("cards")}</button><button className={view === "calc" ? "active" : ""} onClick={() => setView("calc")}>{t("income")}</button></nav><div className="lm-status"><span>●</span> {t("onlineStatus", { online: online.length, total: miners.length, age: age(latest) })}{pending && t("updating")}</div><button className="lm-logout" onClick={() => setSetup(!setup)}>{t("setupButton")}</button><Link className="lm-logout" href="/farms">{t("farmsLink")}</Link></header>
    <main className="lm-wrap"><div className="lm-farm"><b>{farmName}</b><span>{timezone}</span></div><section className="lm-kpis"><Kpi css="lm-k-hash" label={t("totalHashrate")} value={totalHash.toFixed(2)} unit="TH/s" /><Kpi css="lm-k-pow" label={t("totalConsumption")} value={(totalPower / 1000).toFixed(2)} unit="kW" /><Kpi css="lm-k-eff" label={t("efficiency")} value={totalHash ? (totalPower / totalHash).toFixed(1) : "—"} unit="J/TH" /><Kpi css="lm-k-on" label={t("online")} value={`${online.length}`} unit={`/ ${miners.length}`} /><Kpi css="lm-k-off" label={t("offline")} value={`${miners.length - online.length}`} /></section>
      <section className="lm-charts"><div className="lm-panel"><div className="lm-panel-head"><h2>{t("hashrateChartTitle")}</h2><div className="lm-ranges">{RANGES.map((minutes) => <button key={minutes} className={range === minutes ? "active" : ""} onClick={() => setRange(minutes)}>{minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${minutes / 60}h` : "24h"}</button>)}</div></div><LineChart values={chart.map((point) => point.hashrate)} color="#3ddca0" /></div><div className="lm-panel"><div className="lm-panel-head"><h2>{t("consumptionChartTitle")}</h2></div><LineChart values={chart.map((point) => point.power / 1000)} color="#5c9cff" /></div></section>
      {view === "calc" ? <Calculator miners={miners} /> : <><div className="lm-bar"><input type="search" placeholder={t("filterPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} /><select value={type} onChange={(e) => setType(e.target.value)}><option value="">{t("allTypes")}</option><option value="antminer">Antminer</option><option value="whatsminer">Whatsminer</option><option value="avalon">Avalon</option></select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t("onlineAndOffline")}</option><option value="on">{t("onlyOnline")}</option><option value="off">{t("onlyOffline")}</option></select><span /><button className="lm-btn lm-pool-button" onClick={() => { setPoolMinerId(null); setPoolOpen(true); }}>⇄ {t("changePool")}</button><button className="lm-btn lm-primary" onClick={() => setAddOpen(true)}>+ {t("addMachine")}</button><button className="lm-btn" onClick={() => startTransition(() => router.refresh())}>↻ {t("refresh")}</button></div>{view === "table" ? <div className="lm-tablewrap"><div className="lm-scroll"><table><thead><tr>{th(t("colMachine"), "name")}{th(t("colIp"), "ip")}{th(t("colType"), "type")}{th("TH/s", "hashrate_ths")}{th(t("consumptionLabel"), "power_w")}{th(t("colVoltageCurrent"))}{th(t("colHashboards"))}{th(t("colCooling"))}{th(t("colUptime"), "uptime_s")}{th(t("colRejected"), "rejected")}</tr></thead><tbody>{rows.length ? rows.map((miner) => <MinerRow key={miner.id} miner={miner} open={() => setSelected(miner)} />) : <tr><td colSpan={10} className="lm-empty">{t("noMachinesMatch")}</td></tr>}</tbody></table></div></div> : <div className="lm-cards">{rows.map((miner) => <MinerCard key={miner.id} miner={miner} open={() => setSelected(miner)} />)}</div>}</>}
      {setup && <section className="lm-setup">{agentPanel}</section>}
      <PoolCommandHistory commands={poolCommands} />
    </main>{(selected || addOpen) && <Modal miner={selected} close={() => { setSelected(null); setAddOpen(false); }} addAction={addMinerAction} changePool={(minerId) => { setSelected(null); setPoolMinerId(minerId); setPoolOpen(true); }} deleteMiner={removeMiner} rebootMiner={restartMiner} />}
    {poolOpen && <PoolModal key={poolMinerId ?? "batch"} farmId={farmId} miners={miners} initialMinerId={poolMinerId} onClose={() => setPoolOpen(false)} />}
  </div>;
}

function Kpi({ css, label, value, unit }: { css: string; label: string; value: string; unit?: string }) { return <div className={`lm-kpi ${css}`}><span>{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong></div>; }
function MinerRow({ miner, open }: { miner: MonitorMiner; open: () => void }) {
  const t = useTranslations("farmDetail");
  const locale = useLocale();
  if (miner.licensed === false) return <tr className="lm-unlicensed" onClick={open}><td><span className="lm-dot lm-off" /><b>{miner.name}</b></td><td className="lm-num lm-dim">{miner.ip}</td><td><span className="lm-tag">{miner.type}</span></td><td colSpan={7} className="lm-license-cell">{t("awaitingLicense")}<Link href="/billing" onClick={(e) => e.stopPropagation()}>{t("buyLicense")}</Link></td></tr>;
  return <tr onClick={open}><td><span className={`lm-dot ${miner.online ? "lm-on" : "lm-off"}`} /><b>{miner.name}</b></td><td className="lm-num lm-dim"><a className="lm-iplink" href={`http://${miner.ip}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{miner.ip}</a></td><td><span className="lm-tag">{miner.type}</span></td><td className="lm-num">{hash(miner.hashrate_ths)}</td><td className="lm-num">{watts(miner.power_w, locale)} {miner.power_estimated && <span className="lm-est">{t("powerEstimatedTag")}</span>}</td><td className="lm-num"><VA miner={miner} /></td><td><ThermalStrip miner={miner} /></td><td><Cooling miner={miner} /></td><td className="lm-num lm-dim">{uptime(miner.uptime_s)}</td><td className={`lm-num ${n(miner.rejected) ? "lm-warm" : "lm-dim"}`}>{n(miner.rejected) ?? 0}</td></tr>;
}
function MinerCard({ miner, open }: { miner: MonitorMiner; open: () => void }) {
  const t = useTranslations("farmDetail");
  const locale = useLocale();
  if (miner.licensed === false) return <article className="lm-mcard lm-unlicensed" onClick={open}><div className="lm-mc-top"><span className="lm-dot lm-off" /><div><b>{miner.name}</b><small>{miner.ip} · {miner.type}</small></div></div><p className="lm-license-cell">{t("awaitingLicense")}<Link href="/billing" onClick={(e) => e.stopPropagation()}>{t("buyLicense")}</Link></p></article>;
  return <article className={`lm-mcard ${miner.online ? "" : "lm-offline"}`} onClick={open}><div className="lm-mc-top"><span className={`lm-dot ${miner.online ? "lm-on" : "lm-off"}`} /><div><b>{miner.name}</b><small>{miner.ip} · {miner.model ?? miner.type}</small></div><span className="lm-tag">{miner.type}</span></div><div className="lm-mc-metrics"><div><span>{t("hashrateLabel")}</span><strong>{hash(miner.hashrate_ths)}<small> TH/s</small></strong></div><div><span>{t("consumptionLabel")}</span><strong>{watts(miner.power_w, locale)}<small> W</small></strong></div></div><p className="lm-strip-label">{t("hashboardsLabel")}</p><ThermalStrip miner={miner} large /><div className="lm-card-cooling"><Cooling miner={miner} /></div><footer><VA miner={miner} /><span>{uptime(miner.uptime_s)}</span><span>{t("rejectedShort", { count: n(miner.rejected) ?? 0 })}</span></footer></article>;
}
function Modal({ miner, close, addAction, changePool, deleteMiner, rebootMiner }: { miner: MonitorMiner | null; close: () => void; addAction: (formData: FormData) => void | Promise<void>; changePool: (minerId: string) => void; deleteMiner: (minerId: string) => void; rebootMiner: (minerId: string) => Promise<RebootResult> }) {
  const t = useTranslations("farmDetail");
  const locale = useLocale();
  const [rebooting, setRebooting] = useState(false);
  const [rebootFeedback, setRebootFeedback] = useState<RebootResult | null>(null);
  const doReboot = async () => {
    if (!miner) return;
    setRebooting(true); setRebootFeedback(null);
    const result = await rebootMiner(miner.id);
    setRebootFeedback(result); setRebooting(false);
  };
  const doDelete = () => { if (miner && window.confirm(t("deleteMachineConfirm", { name: miner.name }))) deleteMiner(miner.id); };
  return <div className="lm-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}><div className="lm-modal"><button className="lm-close" onClick={close} aria-label={t("closeModal")}>×</button>
    {miner ? <>
      <h3>{miner.name}</h3>
      <p className="lm-sub">{miner.type} · {miner.ip}:{miner.port} · {miner.licensed === false ? t("awaitingLicenseStatus") : miner.online ? t("onlineStatusWord") : t("offlineStatusWord")}{miner.error && ` · ${miner.error}`}</p>
      {miner.licensed === false
        ? <p className="lm-license-cell">{t("licenseBlockedBody")}<Link href="/billing">{t("buyMoreLicenses")}</Link>.</p>
        : <>
            <div className="lm-kv"><Detail label={t("detailModel")} value={miner.model ?? "—"} /><Detail label={t("detailCurrentHashrate")} value={`${hash(miner.hashrate_ths)} TH/s`} /><Detail label={t("detailAvgHashrate")} value={`${hash(miner.hashrate_avg_ths)} TH/s`} /><Detail label={t("detailConsumption")} value={`${watts(miner.power_w, locale)} W`} /><Detail label={t("detailVoltageCurrent")} value={<VA miner={miner} />} /><Detail label={t("detailEfficiency")} value={`${n(miner.efficiency_jth)?.toFixed(1) ?? "—"} J/TH`} /><Detail label={t("detailCooling")} value={<Cooling miner={miner} full />} /><Detail label={t("detailUptime")} value={uptime(miner.uptime_s)} /><Detail label={t("detailAcceptedShares")} value={`${n(miner.accepted) ?? 0}`} /><Detail label={t("detailRejectedShares")} value={`${n(miner.rejected) ?? 0}`} /><Detail label={t("detailPool")} value={miner.pool ?? "—"} /><Detail label={t("detailWorker")} value={miner.worker ?? "—"} /></div>
            <h4>{t("temperaturePerBoard")}</h4><ThermalStrip miner={miner} large />
            {rebootFeedback && <p className={`lm-command-feedback ${rebootFeedback.ok ? "ok" : "error"}`}>{rebootFeedback.message}</p>}
            <div className="lm-detail-actions"><button className="lm-btn lm-pool-button" onClick={() => changePool(miner.id)}>⇄ {t("changePoolForMachine")}</button><button className="lm-btn" disabled={rebooting} onClick={doReboot}>{rebooting ? t("rebooting") : `⟲ ${t("rebootMachine")}`}</button></div>
          </>}
      <div className="lm-detail-actions"><button className="lm-btn lm-danger" onClick={doDelete}>🗑 {t("deleteMachine")}</button></div>
    </> : <><h3>{t("addMachineTitle")}</h3><p className="lm-sub">{t("addMachineSubtitle")}</p><form action={addAction} onSubmit={close}><label>{t("nameLabel")}<input name="name" required placeholder={t("namePlaceholder")} /></label><label>{t("ipLabel")}<input name="ip" required placeholder="192.168.1.101" /></label><label>{t("typeLabel")}<select name="type" defaultValue="antminer"><option value="antminer">Antminer</option><option value="whatsminer">Whatsminer</option><option value="avalon">Avalon</option></select></label><label>{t("portLabel")}<input name="port" type="number" defaultValue="4028" /></label><button className="lm-btn lm-primary" type="submit">{t("add")}</button></form></>}
  </div></div>;
}
function Detail({ label, value }: { label: string; value: ReactNode }) { return <div><span>{label}</span><b>{value}</b></div>; }
