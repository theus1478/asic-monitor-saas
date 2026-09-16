import type { createServiceClient } from "../supabase/service";
import { normalizeMinerPayload, type NormalizedMinerStatus } from "./normalize";
import { evaluateRules, type ActiveIncidentInfo, type RuleOutcome } from "./rules";
import { getAlertSettings } from "./settings";
import { queueIncidentEmail } from "./email";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type MetricRow = {
  miner_id: string;
  online: boolean;
  hashrate_ths: number | null;
  temperature_c: number | null;
  payload: Record<string, unknown>;
};

export type MinerRow = { id: string; name: string; ip: string; model: string | null; type: string; farm_id: string; baseline_hashrate_ths: number | null };
export type IncidentRow = {
  id: string; miner_id: string; rule_key: string; severity: string; status: string;
  started_at: string; last_detected_at: string; occurrence_count: number; last_notified_at: string | null;
};

const BASELINE_ALPHA = 0.02; // media movel lenta (~ meia-vida de dezenas de ciclos) - acompanha mudancas reais sem reagir a ruido

/**
 * Roda o motor de regras para um lote de leituras recem-inseridas em
 * miner_metrics (mesma requisicao POST /api/agent/metrics). Le o estado
 * anterior de cada maquina, decide abrir/atualizar/resolver ocorrencias,
 * grava eventos curados e enfileira e-mails - tudo no backend, como pedido.
 */
export async function processTelemetryBatch(
  service: ServiceClient,
  params: { organizationId: string; farmId: string; previousByMiner: Map<string, { online: boolean; hashrate_ths: number | null; temperature_c: number | null; payload: Record<string, unknown> } | null>; rows: MetricRow[] },
) {
  const { organizationId, farmId, previousByMiner, rows } = params;
  if (rows.length === 0) return;

  const minerIds = rows.map((r) => r.miner_id);
  const settings = await getAlertSettings(service, organizationId);

  const [{ data: minerRows }, { data: incidentRows }] = await Promise.all([
    service.from("miners").select("id, name, ip, model, type, farm_id, baseline_hashrate_ths").in("id", minerIds),
    // "acknowledged" continua contando como em aberto pro motor - reconhecer
    // não é resolver (pedido explícito): a ocorrência segue sendo
    // atualizada/resolvida normalmente, só ganha o carimbo de quem viu.
    service.from("asic_incidents").select("id, miner_id, rule_key, severity, status, started_at, last_detected_at, occurrence_count, last_notified_at").in("miner_id", minerIds).in("status", ["active", "acknowledged"]),
  ]);
  const minerById = new Map((minerRows ?? []).map((m) => [m.id, m as MinerRow]));
  const incidentsByMiner = new Map<string, Map<string, IncidentRow>>();
  for (const incident of (incidentRows ?? []) as IncidentRow[]) {
    if (!incidentsByMiner.has(incident.miner_id)) incidentsByMiner.set(incident.miner_id, new Map());
    incidentsByMiner.get(incident.miner_id)!.set(incident.rule_key, incident);
  }

  const incidentInserts: Record<string, unknown>[] = [];
  const incidentUpdates: { id: string; fields: Record<string, unknown> }[] = [];
  const incidentResolutions: string[] = [];
  const eventRows: Record<string, unknown>[] = [];
  const baselineUpdates: { id: string; value: number }[] = [];
  const emailQueue: { incidentId: string; miner: MinerRow; farmId: string; outcome: RuleOutcome; recipients: string[] }[] = [];

  for (const row of rows) {
    const miner = minerById.get(row.miner_id);
    if (!miner) continue;
    const previousRaw = previousByMiner.get(row.miner_id) ?? null;
    const current = normalizeMinerPayload(row.payload, { online: row.online, hashrateThs: row.hashrate_ths, temperatureC: row.temperature_c });
    const previous: NormalizedMinerStatus | null = previousRaw ? normalizeMinerPayload(previousRaw.payload, { online: previousRaw.online, hashrateThs: previousRaw.hashrate_ths, temperatureC: previousRaw.temperature_c }) : null;

    const activeForMiner = incidentsByMiner.get(row.miner_id) ?? new Map<string, IncidentRow>();
    const activeIncidents = new Map<string, ActiveIncidentInfo>(
      [...activeForMiner.entries()].map(([key, inc]) => [key, { id: inc.id, startedAt: inc.started_at, occurrenceCount: inc.occurrence_count }]),
    );

    const outcomes = row.online || previous ? evaluateRules({
      miner: { id: miner.id, name: miner.name, ip: miner.ip, model: miner.model },
      current, previous, baselineHashrateThs: miner.baseline_hashrate_ths, settings, activeIncidents,
    }) : [];
    const outcomeByRule = new Map(outcomes.map((o) => [o.ruleKey, o]));

    // Resolve o que estava ativo e não foi mais detectado neste ciclo.
    for (const [ruleKey, incident] of activeForMiner) {
      if (outcomeByRule.has(ruleKey)) continue;
      incidentResolutions.push(incident.id);
      eventRows.push({ miner_id: miner.id, incident_id: incident.id, level: "info", category: ruleCategory(ruleKey), message: `Recuperado: ${incident.rule_key}`, data: {} });
    }

    // Cria/atualiza o que está falhando agora.
    for (const [ruleKey, outcome] of outcomeByRule) {
      const existing = activeForMiner.get(ruleKey);
      if (existing) {
        incidentUpdates.push({
          id: existing.id,
          fields: {
            severity: outcome.severity, title: outcome.title, description: outcome.description,
            detected_value: outcome.detectedValue, threshold_value: outcome.thresholdValue, technical_data: outcome.technicalData,
            occurrence_count: existing.occurrence_count + 1, last_detected_at: new Date().toISOString(),
          },
        });
        if (shouldEmail(outcome, existing, existing.started_at, settings)) emailQueue.push({ incidentId: existing.id, miner, farmId, outcome, recipients: settings.email_recipients });
      } else {
        const newId = crypto.randomUUID();
        incidentInserts.push({
          id: newId, miner_id: miner.id, farm_id: miner.farm_id, organization_id: organizationId, rule_key: ruleKey,
          severity: outcome.severity, status: "active", title: outcome.title, description: outcome.description,
          detected_value: outcome.detectedValue, threshold_value: outcome.thresholdValue, technical_data: outcome.technicalData,
          occurrence_count: 1, source: "telemetry",
        });
        eventRows.push({ miner_id: miner.id, incident_id: newId, level: outcome.severity === "critical" ? "critical" : outcome.severity === "warning" ? "warning" : "info", category: ruleCategory(ruleKey), message: outcome.title, data: outcome.technicalData });
        if (shouldEmail(outcome, null, new Date().toISOString(), settings)) emailQueue.push({ incidentId: newId, miner, farmId, outcome, recipients: settings.email_recipients });
      }
    }

    // Baseline de hashrate saudavel: so acompanha leituras sem incidente relevante em andamento.
    const hr = current.hashrateThs;
    if (row.online && hr && hr > 0 && !outcomeByRule.has("zero_hashrate") && !outcomeByRule.has("hashrate_degraded") && !outcomeByRule.has("hashboard_failure")) {
      const baseline = miner.baseline_hashrate_ths;
      const next = baseline == null ? hr : baseline * (1 - BASELINE_ALPHA) + hr * BASELINE_ALPHA;
      if (baseline == null || Math.abs(next - baseline) > 0.01) baselineUpdates.push({ id: miner.id, value: Math.round(next * 1000) / 1000 });
    }
  }

  // Ocorrencias novas precisam existir antes dos eventos que as referenciam
  // (chave estrangeira) - por isso o insert de asic_incidents roda primeiro,
  // nao junto no mesmo Promise.all.
  await Promise.all([
    incidentInserts.length ? service.from("asic_incidents").insert(incidentInserts) : null,
    incidentResolutions.length ? service.from("asic_incidents").update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", incidentResolutions) : null,
    ...incidentUpdates.map((u) => service.from("asic_incidents").update(u.fields).eq("id", u.id)),
    ...baselineUpdates.map((u) => service.from("miners").update({ baseline_hashrate_ths: u.value }).eq("id", u.id)),
  ]);
  if (eventRows.length) await service.from("asic_events").insert(eventRows);

  for (const item of emailQueue) {
    await queueIncidentEmail(service, item);
  }
}

export function shouldEmail(outcome: RuleOutcome, existing: IncidentRow | null, startedAtIso: string, settings: { email_enabled: boolean; disabled_rules: string[]; email_recipients: string[]; reminder_cooldown_minutes: number }) {
  if (!outcome.emailWorthy || !settings.email_enabled || !settings.email_recipients.length) return false;
  if (settings.disabled_rules.includes(outcome.ruleKey)) return false;
  if (outcome.minSustainMinutesForEmail) {
    const sustainedMinutes = (Date.now() - new Date(startedAtIso).getTime()) / 60_000;
    if (sustainedMinutes < outcome.minSustainMinutesForEmail) return false;
  }
  if (!existing) return true;
  if (!existing.last_notified_at) return true;
  const elapsedMinutes = (Date.now() - new Date(existing.last_notified_at).getTime()) / 60_000;
  return elapsedMinutes >= settings.reminder_cooldown_minutes;
}

function ruleCategory(ruleKey: string): string {
  if (ruleKey.startsWith("reboot")) return "reboot";
  if (ruleKey.startsWith("hashboard")) return "hashboard";
  if (ruleKey.startsWith("hashrate") || ruleKey === "zero_hashrate") return "hashrate";
  if (ruleKey.startsWith("temperature")) return "temperature";
  if (ruleKey.startsWith("fan")) return "fan";
  if (ruleKey.startsWith("miner_offline")) return "network";
  return "general";
}
