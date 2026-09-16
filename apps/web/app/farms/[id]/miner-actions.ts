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

export async function updateMinerDevfee(farmId: string, minerId: string, devfeePct: number | null) {
  if (devfeePct != null && (!Number.isFinite(devfeePct) || devfeePct < 0 || devfeePct > 100)) {
    return { ok: false, message: "Informe um percentual entre 0 e 100, ou deixe em branco." };
  }
  const { supabase } = await requireFarmMembership(farmId);
  const { error } = await supabase.from("miners").update({ devfee_pct: devfeePct }).eq("id", minerId).eq("farm_id", farmId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/farms/${farmId}`);
  return { ok: true, message: "Devfee atualizado." };
}

const DEFAULT_CREDENTIALS: Record<string, { username: string; password: string }> = {
  avalon: { username: "root", password: "root" },
  antminer: { username: "admin", password: "admin" },
  whatsminer: { username: "admin", password: "admin" },
};

async function sendMinerCommand(farmId: string, minerId: string, kind: "reboot" | "stop_mining", sentMessage: string) {
  const { user, organizationId } = await requireFarmMembership(farmId);
  const service = createServiceClient();
  const [{ data: agents }, { data: miner }] = await Promise.all([
    service.from("agents").select("id").eq("farm_id", farmId).order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1),
    service.from("miners").select("type").eq("id", minerId).eq("farm_id", farmId).maybeSingle(),
  ]);
  if (!agents?.length) return { ok: false, message: "Instale e configure um coletor antes de enviar comandos." };
  if (!miner) return { ok: false, message: "Máquina não encontrada." };

  const credentials = DEFAULT_CREDENTIALS[miner.type] ?? DEFAULT_CREDENTIALS.antminer;
  const encryptedPayload = encryptPoolCommand({ minerIds: [minerId], credentialsByMiner: { [minerId]: credentials } });
  const { error } = await service.from("pool_commands").insert({
    organization_id: organizationId,
    farm_id: farmId,
    agent_id: agents[0].id,
    kind,
    encrypted_payload: encryptedPayload,
    target_count: 1,
    requested_by: user.id,
  });
  if (error) return { ok: false, message: `Não foi possível enviar o comando: ${error.message}` };
  revalidatePath(`/farms/${farmId}`);
  return { ok: true, message: sentMessage };
}

export async function rebootMiner(farmId: string, minerId: string) {
  return sendMinerCommand(farmId, minerId, "reboot", "Reinício enviado — o coletor aplica no próximo ciclo.");
}

export async function stopMiningOnMiner(farmId: string, minerId: string) {
  return sendMinerCommand(farmId, minerId, "stop_mining", "Comando de parar mineração enviado — o coletor aplica no próximo ciclo.");
}
