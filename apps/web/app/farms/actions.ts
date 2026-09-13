"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { generateAgentToken, hashAgentToken } from "../../lib/agent-token";

async function requireOrgId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) throw new Error("Nenhuma organização encontrada para este usuário.");
  return { supabase, organizationId: membership.organization_id as string };
}

export async function addFarm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Sao_Paulo").trim();
  if (!name) return;

  const { supabase, organizationId } = await requireOrgId();
  await supabase.from("farms").insert({ organization_id: organizationId, name, timezone });
  revalidatePath("/farms");
}

export async function addMiner(farmId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const ip = String(formData.get("ip") ?? "").trim();
  const port = Number(formData.get("port") ?? 4028) || 4028;
  if (!name || !ip) return;

  const { supabase } = await requireOrgId();
  await supabase.from("miners").insert({ farm_id: farmId, name, ip, protocol_port: port });
  revalidatePath(`/farms/${farmId}`);
}

export async function createAgent(farmId: string, name: string) {
  const { supabase } = await requireOrgId();
  const token = generateAgentToken();
  const tokenHash = hashAgentToken(token);

  const { error } = await supabase
    .from("agents")
    .insert({ farm_id: farmId, name: name || "Coletor", token_hash: tokenHash, status: "offline" });

  if (error) throw new Error(error.message);

  revalidatePath(`/farms/${farmId}`);
  return token;
}
