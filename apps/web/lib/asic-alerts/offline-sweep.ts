import type { createServiceClient } from "../supabase/service";
import { getAlertSettings } from "./settings";
import { shouldEmail, type IncidentRow } from "./engine";
import { queueIncidentEmail } from "./email";
import type { RuleOutcome } from "./rules";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * "ASIC offline" não dá pra detectar dentro do POST de telemetria (é a
 * AUSÊNCIA de dados que importa). Reaproveita o mesmo padrão já usado por
 * releaseMaturedCommissions em lib/affiliate.ts: checagem "preguiçosa" toda
 * vez que a Visão Geral ou a página da fazenda carregam, com o cron diário
 * existente como backstop (não dá pra agendar um cron frequente no plano
 * atual do Vercel — o único cron do projeto roda 1x/dia).
 */
export async function sweepOfflineIncidents(service: ServiceClient, organizationId: string) {
  const settings = await getAlertSettings(service, organizationId);
  const cutoff = new Date(Date.now() - settings.offline_after_minutes * 60_000).toISOString();

  const { data: farms } = await service.from("farms").select("id").eq("organization_id", organizationId);
  const farmIds = (farms ?? []).map((f) => f.id);
  if (!farmIds.length) return;

  const { data: miners } = await service.from("miners").select("id, name, ip, model, farm_id").in("farm_id", farmIds);
  const minerList = miners ?? [];
  if (!minerList.length) return;
  const minerIds = minerList.map((m) => m.id);

  const [{ data: latestMetrics }, { data: activeOffline }] = await Promise.all([
    service.from("miner_metrics").select("miner_id, observed_at").in("miner_id", minerIds).order("observed_at", { ascending: false }).limit(minerIds.length * 3),
    service.from("asic_incidents").select("id, miner_id, rule_key, severity, status, started_at, last_detected_at, occurrence_count, last_notified_at").in("miner_id", minerIds).in("status", ["active", "acknowledged"]).eq("rule_key", "miner_offline"),
  ]);
  const lastSeenByMiner = new Map<string, string>();
  for (const row of latestMetrics ?? []) if (!lastSeenByMiner.has(row.miner_id)) lastSeenByMiner.set(row.miner_id, row.observed_at);
  const offlineByMiner = new Map(((activeOffline ?? []) as IncidentRow[]).map((i) => [i.miner_id, i]));

  const toInsert: Record<string, unknown>[] = [];
  const toResolve: string[] = [];
  const toTouch: string[] = [];
  const eventRows: Record<string, unknown>[] = [];
  const emailTargets: { incidentId: string; miner: typeof minerList[number]; outcome: RuleOutcome; startedAt: string; existing: IncidentRow | null }[] = [];

  for (const miner of minerList) {
    const lastSeen = lastSeenByMiner.get(miner.id) ?? null;
    const isStale = !lastSeen || lastSeen < cutoff;
    const existing = offlineByMiner.get(miner.id) ?? null;

    if (isStale && !existing) {
      const newId = crypto.randomUUID();
      const outcome: RuleOutcome = {
        ruleKey: "miner_offline", severity: "critical", title: "ASIC offline",
        description: lastSeen ? `Sem comunicação desde ${new Date(lastSeen).toLocaleString("pt-BR")}.` : "Nunca reportou telemetria.",
        detectedValue: null, thresholdValue: settings.offline_after_minutes,
        technicalData: { last_seen_at: lastSeen }, emailWorthy: true,
      };
      toInsert.push({ id: newId, miner_id: miner.id, farm_id: miner.farm_id, organization_id: organizationId, rule_key: outcome.ruleKey, severity: outcome.severity, status: "active", title: outcome.title, description: outcome.description, detected_value: outcome.detectedValue, threshold_value: outcome.thresholdValue, technical_data: outcome.technicalData, occurrence_count: 1, source: "sweep" });
      eventRows.push({ miner_id: miner.id, incident_id: newId, level: "critical", category: "network", message: outcome.title, data: outcome.technicalData });
      if (shouldEmail(outcome, null, new Date().toISOString(), settings)) emailTargets.push({ incidentId: newId, miner, outcome, startedAt: new Date().toISOString(), existing: null });
    } else if (isStale && existing) {
      const outcome: RuleOutcome = {
        ruleKey: "miner_offline", severity: "critical", title: "ASIC offline",
        description: `Sem comunicação desde ${lastSeen ? new Date(lastSeen).toLocaleString("pt-BR") : "cadastro"}.`,
        detectedValue: null, thresholdValue: settings.offline_after_minutes, technicalData: { last_seen_at: lastSeen }, emailWorthy: true,
      };
      if (shouldEmail(outcome, existing, existing.started_at, settings)) {
        toTouch.push(existing.id);
        emailTargets.push({ incidentId: existing.id, miner, outcome, startedAt: existing.started_at, existing });
      }
    } else if (!isStale && existing) {
      toResolve.push(existing.id);
      eventRows.push({ miner_id: miner.id, incident_id: existing.id, level: "info", category: "network", message: "ASIC voltou a ficar online", data: { downtime_since: existing.started_at } });
    }
  }

  await Promise.all([
    toInsert.length ? service.from("asic_incidents").insert(toInsert) : null,
    toResolve.length ? service.from("asic_incidents").update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", toResolve) : null,
    ...toTouch.map((id) => service.from("asic_incidents").update({ last_detected_at: new Date().toISOString() }).eq("id", id)),
  ]);
  if (eventRows.length) await service.from("asic_events").insert(eventRows);

  const recipients = settings.email_recipients;
  for (const target of emailTargets) {
    await queueIncidentEmail(service, { incidentId: target.incidentId, miner: target.miner, farmId: target.miner.farm_id, outcome: target.outcome, recipients });
  }
}
