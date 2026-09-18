"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLicensedMachineCount, markLicensed } from "../../../lib/license";
import { remoteMachineUrl, signRemoteLink } from "../../../lib/remote-access";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

export type RemoteResult = { ok: true; url: string } | { ok: false; message: string };
export type RemoteToggleResult = { ok: boolean; message: string };

// Visualizadores só olham; abrir a tela da ASIC (que permite trocar configuração) exige papel operacional.
const ALLOWED_ROLES = new Set(["owner", "admin", "operator"]);

async function requireOperator(farmId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
  // A RLS já limita "farms" às organizações do usuário.
  const { data: farm } = await supabase.from("farms").select("id, organization_id, remote_access_enabled").eq("id", farmId).maybeSingle();
  if (!farm) throw new Error("Fazenda não encontrada.");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).eq("organization_id", farm.organization_id).maybeSingle();
  if (!membership || !ALLOWED_ROLES.has(membership.role)) throw new Error("Você não tem permissão para usar o acesso remoto nesta fazenda.");
  return { user, farm };
}

async function requestIp() {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim().slice(0, 64) || null;
}

export async function createRemoteAccess(farmId: string, minerId: string): Promise<RemoteResult> {
  try {
    const { user, farm } = await requireOperator(farmId);
    if (!farm.remote_access_enabled) return { ok: false, message: "O acesso remoto está desligado nesta fazenda. Ligue-o no painel Telemetria." };

    const service = createServiceClient();
    const { data: miner } = await service.from("miners").select("id, created_at").eq("id", minerId).eq("farm_id", farm.id).eq("enabled", true).maybeSingle();
    if (!miner) return { ok: false, message: "Máquina não encontrada." };

    // Mesma regra da telemetria: máquina fora da licença não tem acesso.
    const { data: orgFarms } = await service.from("farms").select("id").eq("organization_id", farm.organization_id);
    const farmIds = (orgFarms ?? []).map((item) => item.id);
    const [{ data: orgMiners }, licensedCount] = await Promise.all([
      service.from("miners").select("id, created_at").eq("enabled", true).in("farm_id", farmIds.length ? farmIds : [farm.id]),
      getLicensedMachineCount(service, farm.organization_id),
    ]);
    if (!markLicensed(orgMiners ?? [], licensedCount).get(miner.id)) return { ok: false, message: "Esta máquina está fora da licença contratada." };

    const token = signRemoteLink({ minerId: miner.id, organizationId: farm.organization_id, userId: user.id });
    await service.from("remote_access_logs").insert({ organization_id: farm.organization_id, miner_id: miner.id, user_id: user.id, action: "open", ip: await requestIp() });
    return { ok: true, url: remoteMachineUrl(miner.id, token) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Não foi possível abrir o acesso remoto." };
  }
}

export async function setFarmRemoteAccess(farmId: string, enabled: boolean): Promise<RemoteToggleResult> {
  try {
    const { user, farm } = await requireOperator(farmId);
    const service = createServiceClient();
    const { error } = await service.from("farms").update({ remote_access_enabled: enabled }).eq("id", farm.id);
    if (error) return { ok: false, message: error.message };
    await service.from("remote_access_logs").insert({ organization_id: farm.organization_id, user_id: user.id, action: enabled ? "enable" : "disable", ip: await requestIp() });
    revalidatePath(`/farms/${farmId}`);
    return { ok: true, message: enabled ? "Acesso remoto ligado. O coletor conecta em até 1 minuto." : "Acesso remoto desligado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Não foi possível alterar o acesso remoto." };
  }
}
