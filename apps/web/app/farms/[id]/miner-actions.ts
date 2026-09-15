"use server";

import { revalidatePath } from "next/cache";
import { encryptPoolCommand } from "../../../lib/pool-command-crypto";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

async function requireFarmMembership(farmId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
  const { data: membership } = await supabase.from("memberships").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) throw new Error("Organização não encontrada.");
  const { data: farm } = await supabase.from("farms").select("id").eq("id", farmId).eq("organization_id", membership.organization_id).maybeSingle();
  if (!farm) throw new Error("Fazenda não encontrada.");
  return { supabase, user, organizationId: membership.organization_id as string };
}

export async function deleteMiner(farmId: string, minerId: string) {
  const { supabase } = await requireFarmMembership(farmId);
  const { error } = await supabase.from("miners").delete().eq("id", minerId).eq("farm_id", farmId);
  if (error) throw new Error(error.message);
  revalidatePath(`/farms/${farmId}`);
}

export async function rebootMiner(farmId: string, minerId: string) {
  const { user, organizationId } = await requireFarmMembership(farmId);
  const service = createServiceClient();
  const { data: agents } = await service.from("agents").select("id").eq("farm_id", farmId).order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1);
  if (!agents?.length) return { ok: false, message: "Instale e configure um coletor antes de reiniciar máquinas." };

  const encryptedPayload = encryptPoolCommand({ minerIds: [minerId] });
  const { error } = await service.from("pool_commands").insert({
    organization_id: organizationId,
    farm_id: farmId,
    agent_id: agents[0].id,
    kind: "reboot",
    encrypted_payload: encryptedPayload,
    target_count: 1,
    requested_by: user.id,
  });
  if (error) return { ok: false, message: `Não foi possível enviar o comando: ${error.message}` };
  revalidatePath(`/farms/${farmId}`);
  return { ok: true, message: "Reinício enviado — o coletor aplica no próximo ciclo." };
}
