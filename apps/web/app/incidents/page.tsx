import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { AcknowledgeButton } from "./acknowledge-button";

type IncidentRow = {
  id: string; miner_id: string; farm_id: string; rule_key: string; severity: "info" | "warning" | "critical";
  status: "active" | "resolved" | "acknowledged"; title: string; description: string; occurrence_count: number;
  started_at: string; last_detected_at: string; resolved_at: string | null; acknowledged_at: string | null;
};
type Props = { searchParams: Promise<{ status?: string; severity?: string; farm?: string }> };

export default async function IncidentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const t = await getTranslations("incidents");
  const { supabase, organizationId } = await getOrganizationId();

  const { data: farms } = organizationId ? await supabase.from("farms").select("id, name").eq("organization_id", organizationId).order("name") : { data: [] as { id: string; name: string }[] };
  const farmList = farms ?? [];
  const farmIds = farmList.map((f) => f.id);

  const { data: miners } = farmIds.length ? await supabase.from("miners").select("id, name, farm_id").in("farm_id", farmIds) : { data: [] as { id: string; name: string; farm_id: string }[] };
  const minerById = new Map((miners ?? []).map((m) => [m.id, m]));
  const farmById = new Map(farmList.map((f) => [f.id, f.name]));

  const status = params.status && ["active", "resolved", "acknowledged"].includes(params.status) ? params.status : "active";
  const severity = params.severity && ["info", "warning", "critical"].includes(params.severity) ? params.severity : "";
  const farmFilter = params.farm && farmIds.includes(params.farm) ? params.farm : "";

  let query = supabase.from("asic_incidents").select("id, miner_id, farm_id, rule_key, severity, status, title, description, occurrence_count, started_at, last_detected_at, resolved_at, acknowledged_at").order("last_detected_at", { ascending: false }).limit(200);
  if (farmIds.length) query = query.in("farm_id", farmIds); else query = query.eq("farm_id", "00000000-0000-0000-0000-000000000000");
  if (status) query = query.eq("status", status);
  if (severity) query = query.eq("severity", severity);
  if (farmFilter) query = query.eq("farm_id", farmFilter);
  const { data: incidentRows } = await query;
  const incidents = (incidentRows ?? []) as IncidentRow[];

  const buildHref = (next: Partial<{ status: string; severity: string; farm: string }>) => {
    const merged = { status, severity, farm: farmFilter, ...next };
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)));
    return `/incidents${qs.toString() ? `?${qs}` : ""}`;
  };

  return <Shell><PageHeader title={t("title")} description={t("description")} />
    <section className="card table-card">
      <div className="section-title"><div><h2>{t("filtersTitle")}</h2></div></div>
      <div className="inline-form" style={{ flexWrap: "wrap", marginBottom: 18 }}>
        <div className="lm-c-mode">{(["active", "acknowledged", "resolved"] as const).map((s) => <Link key={s} href={buildHref({ status: s })} className={status === s ? "active" : ""}>{t(`status_${s}`)}</Link>)}</div>
        <div className="lm-c-mode">
          <Link href={buildHref({ severity: "" })} className={severity === "" ? "active" : ""}>{t("severityAll")}</Link>
          {(["critical", "warning", "info"] as const).map((s) => <Link key={s} href={buildHref({ severity: s })} className={severity === s ? "active" : ""}>{t(`severity_${s}`)}</Link>)}
        </div>
        {farmList.length > 1 && <div className="lm-c-mode"><Link href={buildHref({ farm: "" })} className={farmFilter === "" ? "active" : ""}>{t("allFarms")}</Link>{farmList.map((f) => <Link key={f.id} href={buildHref({ farm: f.id })} className={farmFilter === f.id ? "active" : ""}>{f.name}</Link>)}</div>}
      </div>

      {incidents.length === 0
        ? <p className="muted">{t("empty")}</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>{t("colMachine")}</th><th>{t("colFarm")}</th><th>{t("colType")}</th><th>{t("colSeverity")}</th><th>{t("colStatus")}</th><th>{t("colStarted")}</th><th>{t("colLastDetected")}</th><th /></tr></thead>
            <tbody>{incidents.map((incident) => {
              const miner = minerById.get(incident.miner_id);
              return <tr key={incident.id}>
                <td><Link href={`/farms/${incident.farm_id}?miner=${incident.miner_id}`}><b>{miner?.name ?? "—"}</b></Link><br /><small className="muted">{incident.title}</small></td>
                <td className="muted">{farmById.get(incident.farm_id) ?? "—"}</td>
                <td className="lm-mono">{incident.rule_key}</td>
                <td><span className={`badge ${incident.severity === "critical" ? "" : incident.severity === "warning" ? "warning" : "neutral"}`} style={incident.severity === "critical" ? { background: "#ff5d6c1f", color: "#ff9aa3" } : undefined}>{t(`severity_${incident.severity}`)}</span></td>
                <td><span className={`badge ${incident.status === "resolved" ? "success" : incident.status === "acknowledged" ? "neutral" : "warning"}`}>{t(`status_${incident.status}`)}</span></td>
                <td className="muted">{new Date(incident.started_at).toLocaleString()}</td>
                <td className="muted">{new Date(incident.last_detected_at).toLocaleString()}</td>
                <td>{incident.status === "active" && <AcknowledgeButton incidentId={incident.id} label={t("acknowledge")} pendingLabel={t("acknowledging")} />}</td>
              </tr>;
            })}</tbody>
          </table></div>}
    </section>
  </Shell>;
}
