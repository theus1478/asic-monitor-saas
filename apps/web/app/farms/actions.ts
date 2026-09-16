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
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!name) return;

  const { supabase, organizationId } = await requireOrgId();
  await supabase.from("farms").insert({ organization_id: organizationId, name, timezone: timezone || null });
  revalidatePath("/farms");
}

export async function renameFarm(farmId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { supabase, organizationId } = await requireOrgId();
  const { error } = await supabase.from("farms").update({ name: trimmed }).eq("id", farmId).eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  revalidatePath("/farms");
  revalidatePath(`/farms/${farmId}`);
}

const MINER_TYPES = new Set(["antminer", "whatsminer", "avalon"]);

export async function addMiner(farmId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const ip = String(formData.get("ip") ?? "").trim();
  const port = Number(formData.get("port") ?? 4028) || 4028;
  const typeRaw = String(formData.get("type") ?? "antminer").trim().toLowerCase();
  const type = MINER_TYPES.has(typeRaw) ? typeRaw : "antminer";
  if (!name || !ip) return;

  const { supabase, organizationId } = await requireOrgId();
  const { data: farm } = await supabase.from("farms").select("id").eq("id", farmId).eq("organization_id", organizationId).maybeSingle();
  if (!farm) throw new Error("Fazenda não encontrada.");
  // Sempre cadastra, mesmo sem licença disponível — a máquina fica visível
  // com um aviso pedindo licença até o cliente comprar (ver lib/license.ts).
  await supabase.from("miners").insert({ farm_id: farmId, name, ip, protocol_port: port, type });
  revalidatePath(`/farms/${farmId}`);
}

export async function deleteFarm(farmId: string) {
  const { supabase, organizationId } = await requireOrgId();
  const { error } = await supabase.from("farms").delete().eq("id", farmId).eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  revalidatePath("/farms");
  revalidatePath("/dashboard");
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
