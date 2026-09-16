"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

export async function acknowledgeIncident(incidentId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sua sessão expirou. Entre novamente." };

  const { error } = await supabase
    .from("asic_incidents")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by: user.id })
    .eq("id", incidentId)
    .eq("status", "active");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
  return { ok: true, message: "Ocorrência reconhecida." };
}
