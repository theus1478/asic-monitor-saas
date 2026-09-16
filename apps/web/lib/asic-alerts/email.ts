import { Resend } from "resend";
import type { createServiceClient } from "../supabase/service";
import type { RuleOutcome } from "./rules";

type ServiceClient = ReturnType<typeof createServiceClient>;

const SEVERITY_LABEL: Record<string, string> = { critical: "CRÍTICO", warning: "ALERTA", info: "INFO" };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function buildEmailHtml(params: {
  minerName: string; model: string | null; ip: string; farmName: string; ruleKey: string;
  severity: string; occurredAt: string; hashrateThs: number | null; expectedHashrateThs: number | null;
  temperatureC: number | null; boardsAvailable: string | null; description: string; link: string;
}) {
  const rows: [string, string][] = [
    ["Máquina", escapeHtml(params.minerName)],
    ["Modelo", escapeHtml(params.model ?? "—")],
    ["IP", escapeHtml(params.ip)],
    ["Localização", escapeHtml(params.farmName)],
    ["Tipo de ocorrência", escapeHtml(params.ruleKey)],
    ["Severidade", SEVERITY_LABEL[params.severity] ?? params.severity.toUpperCase()],
    ["Data/hora", new Date(params.occurredAt).toLocaleString("pt-BR")],
    ["Hashrate atual", params.hashrateThs != null ? `${params.hashrateThs.toFixed(2)} TH/s` : "—"],
    ["Hashrate esperado", params.expectedHashrateThs != null ? `${params.expectedHashrateThs.toFixed(2)} TH/s` : "—"],
    ["Temperatura", params.temperatureC != null ? `${params.temperatureC.toFixed(0)}°C` : "—"],
    ["Hashboards disponíveis", params.boardsAvailable ?? "—"],
  ];
  const rowsHtml = rows.map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#94a3b8;font-size:13px;white-space:nowrap">${label}</td><td style="padding:6px 0;color:#e8eef9;font-size:13px;font-weight:600">${value}</td></tr>`).join("");
  return `<div style="background:#090d13;padding:32px 16px;font-family:Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#121924;border:1px solid #263248;border-radius:12px;padding:24px">
      <p style="color:#42dba3;font-size:11px;font-weight:700;letter-spacing:.1em;margin:0 0 6px">ASIC MONITOR CLOUD</p>
      <h1 style="color:#e8eef9;font-size:18px;margin:0 0 16px">${escapeHtml(params.description)}</h1>
      <table style="width:100%;border-collapse:collapse">${rowsHtml}</table>
      <a href="${params.link}" style="display:inline-block;margin-top:20px;background:#42dba3;color:#062113;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;font-size:13px">Abrir ASIC na plataforma</a>
    </div>
  </div>`;
}

/**
 * Envia o e-mail de uma ocorrência e registra o resultado. Nunca lança: falha
 * de e-mail não pode impedir o resto do pipeline (a ocorrência já foi
 * persistida antes desta função ser chamada). Em falha, não atualiza
 * last_notified_at — deixa o próximo ciclo tentar de novo, sem esperar o
 * cooldown inteiro por causa de um envio que nem saiu.
 */
export async function queueIncidentEmail(
  service: ServiceClient,
  params: { incidentId: string; miner: { id: string; name: string; ip: string; model: string | null; farm_id: string }; farmId: string; outcome: RuleOutcome; recipients: string[] },
) {
  const { incidentId, miner, farmId, outcome, recipients } = params;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM || "ASIC Monitor <alerts@resend.dev>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monitorasic.club";

  if (!apiKey) {
    await service.from("alert_notifications").insert({ incident_id: incidentId, status: "skipped", error: "RESEND_API_KEY não configurada." });
    return;
  }

  const { data: farm } = await service.from("farms").select("name").eq("id", farmId).maybeSingle();
  const technical = outcome.technicalData as Record<string, unknown>;
  const boards = Array.isArray(technical.boards) ? technical.boards as Array<{ hashrate_ths?: number | null }> : null;
  const boardsAvailable = boards ? `${boards.filter((b) => (b.hashrate_ths ?? 0) > 0).length}/${boards.length}` : typeof technical.working === "number" && typeof technical.expected === "number" ? `${technical.working}/${technical.expected}` : null;

  const subject = `[${SEVERITY_LABEL[outcome.severity] ?? outcome.severity.toUpperCase()}] ${outcome.title} - ASIC ${miner.name}`;
  const html = buildEmailHtml({
    minerName: miner.name, model: miner.model, ip: miner.ip, farmName: farm?.name ?? "—", ruleKey: outcome.ruleKey,
    severity: outcome.severity, occurredAt: new Date().toISOString(),
    hashrateThs: typeof outcome.detectedValue === "number" && (outcome.ruleKey === "zero_hashrate" || outcome.ruleKey === "hashrate_degraded") ? outcome.detectedValue : null,
    expectedHashrateThs: typeof outcome.thresholdValue === "number" && outcome.ruleKey === "hashrate_degraded" ? outcome.thresholdValue : null,
    temperatureC: outcome.ruleKey === "temperature_high" ? outcome.detectedValue : null,
    boardsAvailable, description: outcome.description, link: `${appUrl}/farms/${farmId}?miner=${miner.id}`,
  });

  try {
    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({ from, to: recipients, subject, html });
    if (sendError) {
      await service.from("alert_notifications").insert({ incident_id: incidentId, status: "failed", recipient: recipients.join(", "), error: sendError.message?.slice(0, 300) ?? "Falha ao enviar e-mail." });
      return;
    }
    await Promise.all([
      service.from("alert_notifications").insert({ incident_id: incidentId, status: "sent", recipient: recipients.join(", ") }),
      service.from("asic_incidents").update({ email_sent: true, last_notified_at: new Date().toISOString() }).eq("id", incidentId),
    ]);
  } catch (error) {
    await service.from("alert_notifications").insert({ incident_id: incidentId, status: "failed", recipient: recipients.join(", "), error: error instanceof Error ? error.message.slice(0, 300) : "Falha desconhecida ao enviar e-mail." });
  }
}
