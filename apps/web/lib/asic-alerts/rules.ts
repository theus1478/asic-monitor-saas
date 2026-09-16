import type { AlertSettings } from "./settings";
import type { NormalizedMinerStatus } from "./normalize";

export type Severity = "info" | "warning" | "critical";

export type RuleOutcome = {
  ruleKey: string;
  severity: Severity;
  title: string;
  description: string;
  detectedValue: number | null;
  thresholdValue: number | null;
  technicalData: Record<string, unknown>;
  /** Só regras marcadas aqui entram na fila de e-mail (ver seção 8 do pedido) — as demais só geram ocorrência/evento. */
  emailWorthy: boolean;
  /** Exige a ocorrência ativa há pelo menos N minutos antes do primeiro e-mail (janela temporal - não é gate de exibição, só de envio). */
  minSustainMinutesForEmail?: number;
};

export type ActiveIncidentInfo = { id: string; startedAt: string; occurrenceCount: number };

export type RuleContext = {
  miner: { id: string; name: string; ip: string; model: string | null };
  current: NormalizedMinerStatus;
  previous: NormalizedMinerStatus | null;
  baselineHashrateThs: number | null;
  settings: AlertSettings;
  activeIncidents: Map<string, ActiveIncidentInfo>;
};

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

/** Reinicialização inesperada: uptime atual bem menor que o anterior, com o anterior já "maduro" (evita ruído logo após o primeiro boot). */
function rebootDetected(ctx: RuleContext): RuleOutcome | null {
  const { previous, current } = ctx;
  if (!current.online || !previous?.online) return null;
  const prevUptime = previous.uptimeSeconds, curUptime = current.uptimeSeconds;
  if (prevUptime == null || curUptime == null) return null;
  if (prevUptime < 300) return null; // maquina que acabou de subir - nao é reinicio "novo"
  if (curUptime >= prevUptime - 60) return null; // uptime so cresce; margem de 60s pra ruído de leitura
  return {
    ruleKey: "reboot_detected", severity: "warning",
    title: "ASIC reiniciada", description: "O uptime caiu de forma abrupta, indicando reinicialização não solicitada pelo painel.",
    detectedValue: curUptime, thresholdValue: prevUptime,
    technicalData: { previous_uptime_s: prevUptime, current_uptime_s: curUptime, probable_reason: null },
    emailWorthy: true,
  };
}

/** Hashboard sem funcionamento: alguma placa reportando hashrate zero enquanto outras da mesma maquina produzem, ou placa que sumiu do relatorio. */
function hashboardFailure(ctx: RuleContext): RuleOutcome | null {
  const { current, previous } = ctx;
  if (!current.online || current.boards.length === 0) return null;
  const healthy = current.boards.filter((b) => (b.hashrateThs ?? 0) > 0);
  const failed = current.boards.filter((b) => !((b.hashrateThs ?? 0) > 0));
  const boardsDisappeared = previous && previous.boards.length > current.boards.length ? previous.boards.length - current.boards.length : 0;
  if (failed.length === 0 && boardsDisappeared === 0) return null;
  if (healthy.length === 0 && boardsDisappeared === 0) return null; // todas zeradas ja vira zero_hashrate, nao duplicar
  const failedNames = [...failed.map((b) => b.name)];
  return {
    ruleKey: "hashboard_failure", severity: "critical",
    title: failedNames.length === 1 ? `Hashboard com falha (${failedNames[0]})` : `${failedNames.length} hashboards com falha`,
    description: `${healthy.length}/${current.boards.length} hashboard(s) funcionando (esperado ${current.boards.length + boardsDisappeared}).`,
    detectedValue: healthy.length, thresholdValue: current.boards.length + boardsDisappeared,
    technicalData: { working: healthy.length, expected: current.boards.length + boardsDisappeared, failed_boards: failedNames, boards: current.boards },
    emailWorthy: true,
  };
}

/** ASIC sem hashrate: online mas hashrate essencialmente zero - diferente de offline. */
function zeroHashrate(ctx: RuleContext): RuleOutcome | null {
  const { current } = ctx;
  if (!current.online) return null;
  const hr = current.hashrateThs ?? 0;
  if (hr > 0.01) return null;
  return {
    ruleKey: "zero_hashrate", severity: "critical",
    title: "ASIC sem hashrate", description: "A máquina está online e respondendo, mas não reporta nenhum hashrate.",
    detectedValue: hr, thresholdValue: 0,
    technicalData: { boards: current.boards },
    emailWorthy: true,
  };
}

/** Queda de hashrate vs. a média saudável da própria máquina - usa o tempo de ocorrência ativa como "janela", não uma leitura isolada. */
function hashrateDegraded(ctx: RuleContext): RuleOutcome | null {
  const { current, baselineHashrateThs, settings, activeIncidents } = ctx;
  if (!current.online) return null;
  if (activeIncidents.has("zero_hashrate")) return null; // já coberto por uma regra mais grave
  const hr = current.hashrateThs ?? 0;
  if (baselineHashrateThs == null || baselineHashrateThs <= 0 || hr <= 0) return null;
  const pct = (hr / baselineHashrateThs) * 100;
  if (pct >= settings.hashrate_attention_pct) return null;

  const severity: Severity = pct < settings.hashrate_critical_pct ? "critical" : pct < settings.hashrate_warning_pct ? "warning" : "info";
  return {
    ruleKey: "hashrate_degraded", severity,
    title: "Queda de hashrate", description: `Hashrate em ${pct.toFixed(0)}% da média saudável da máquina (${hr.toFixed(1)} TH/s de ${baselineHashrateThs.toFixed(1)} TH/s esperado).`,
    detectedValue: hr, thresholdValue: baselineHashrateThs,
    technicalData: { percent_of_baseline: Math.round(pct), baseline_hashrate_ths: baselineHashrateThs },
    emailWorthy: severity === "critical",
    minSustainMinutesForEmail: settings.hashrate_window_minutes,
  };
}

function temperatureHigh(ctx: RuleContext): RuleOutcome | null {
  const { current, settings } = ctx;
  if (!current.online || current.temperatureC == null) return null;
  if (current.temperatureC < settings.temp_warning_c) return null;
  const severity: Severity = current.temperatureC >= settings.temp_critical_c ? "critical" : "warning";
  const threshold = severity === "critical" ? settings.temp_critical_c : settings.temp_warning_c;
  return {
    ruleKey: "temperature_high", severity,
    title: severity === "critical" ? "Temperatura crítica" : "Temperatura elevada",
    description: `Maior temperatura reportada: ${current.temperatureC.toFixed(0)}°C (limite: ${threshold}°C).`,
    detectedValue: current.temperatureC, thresholdValue: threshold,
    technicalData: { boards: current.boards.map((b) => ({ name: b.name, chip_temp_c: b.chipTempC })) },
    emailWorthy: severity === "critical",
  };
}

/** Ventoinha com falha ou RPM anormal - só quando a máquina declara refrigeração a ar/hidro (imersão legitimamente tem 0 fan). */
function fanFailure(ctx: RuleContext): RuleOutcome | null {
  const { current } = ctx;
  if (!current.online || current.fansRpm.length === 0) return null;
  if (current.coolingMode === "immersion") return null;
  const stalled = current.fansRpm.filter((rpm) => rpm <= 0).length;
  if (stalled === 0) return null;
  return {
    ruleKey: "fan_failure", severity: "warning",
    title: stalled === current.fansRpm.length ? "Ventoinhas paradas" : "Ventoinha com falha",
    description: `${stalled}/${current.fansRpm.length} ventoinha(s) com RPM zerado.`,
    detectedValue: current.fansRpm.length - stalled, thresholdValue: current.fansRpm.length,
    technicalData: { fans_rpm: current.fansRpm },
    emailWorthy: false,
  };
}

const RULES: ((ctx: RuleContext) => RuleOutcome | null)[] = [
  rebootDetected, hashboardFailure, zeroHashrate, hashrateDegraded, temperatureHigh, fanFailure,
];

/** Roda todas as regras de telemetria (offline é tratado à parte, via varredura periódica - ver sweep.ts). */
export function evaluateRules(ctx: RuleContext): RuleOutcome[] {
  return RULES.map((rule) => rule(ctx)).filter((outcome): outcome is RuleOutcome => outcome !== null);
}

export { minutesSince };
