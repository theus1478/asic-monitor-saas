import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertSettings = {
  temp_warning_c: number;
  temp_critical_c: number;
  hashrate_attention_pct: number;
  hashrate_warning_pct: number;
  hashrate_critical_pct: number;
  hashrate_window_minutes: number;
  offline_after_minutes: number;
  email_enabled: boolean;
  email_recipients: string[];
  reminder_cooldown_minutes: number;
  disabled_rules: string[];
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  temp_warning_c: 85,
  temp_critical_c: 95,
  hashrate_attention_pct: 90,
  hashrate_warning_pct: 75,
  hashrate_critical_pct: 50,
  hashrate_window_minutes: 10,
  offline_after_minutes: 3,
  email_enabled: true,
  email_recipients: [],
  reminder_cooldown_minutes: 120,
  disabled_rules: [],
};

/** Config do motor de regras por organização; cria a linha (com os defaults da migration) na primeira leitura. */
export async function getAlertSettings(service: SupabaseClient, organizationId: string): Promise<AlertSettings> {
  const { data } = await service.from("alert_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (data) return data as AlertSettings;
  const { data: created } = await service.from("alert_settings").insert({ organization_id: organizationId }).select("*").maybeSingle();
  return (created as AlertSettings) ?? DEFAULT_ALERT_SETTINGS;
}
