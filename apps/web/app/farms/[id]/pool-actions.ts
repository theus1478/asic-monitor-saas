"use server";

import { revalidatePath } from "next/cache";
import { encryptPoolCommand } from "../../../lib/pool-command-crypto";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

type PoolInput = { url: string; worker: string; password: string };

const VALID_TYPES = new Set(["antminer", "whatsminer", "avalon"]);
const DEFAULT_CREDENTIALS: Record<string, { username: string; password: string }> = {
  avalon: { username: "root", password: "root" },
  antminer: { username: "admin", password: "admin" },
  whatsminer: { username: "admin", password: "admin" },
};

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parsePools(value: unknown): PoolInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((pool) => ({
    url: cleanText(pool?.url, 400),
    worker: cleanText(pool?.worker, 240),
    password: typeof pool?.password === "string" ? pool.password.slice(0, 240) : "",
  })).filter((pool) => pool.url || pool.worker);
}

export async function createPoolCommand(farmId: string, input: unknown) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sua sessão expirou. Entre novamente." };

  const { data: membership } = await supabase.from("memberships").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) return { ok: false, message: "Organização não encontrada." };

  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const minerIds = Array.isArray(body.minerIds) ? [...new Set(body.minerIds.filter((id): id is string => typeof id === "string"))].slice(0, 500) : [];
  const pools = parsePools(body.pools);
  const useDefaults = body.useDefaults !== false;
  const username = cleanText(body.username, 120);
  const password = typeof body.password === "string" ? body.password.slice(0, 240) : "";

  if (!minerIds.length) return { ok: false, message: "Selecione ao menos uma máquina." };
  if (!pools.length || !pools[0].url || !pools[0].worker) return { ok: false, message: "Preencha a URL e o worker da pool principal." };
  if (pools.some((pool) => !pool.url || !pool.worker || !/^stratum\+(tcp|ssl):\/\//i.test(pool.url))) {
    return { ok: false, message: "Cada pool usada precisa de URL stratum+tcp:// ou stratum+ssl:// e worker." };
  }
  if (!useDefaults && (!username || !password)) return { ok: false, message: "Informe usuário e senha das máquinas." };

  const service = createServiceClient();
  const { data: farm } = await service.from("farms").select("id, organization_id").eq("id", farmId).eq("organization_id", membership.organization_id).maybeSingle();
  if (!farm) return { ok: false, message: "Fazenda não encontrada." };

  const [{ data: miners }, { data: agents }] = await Promise.all([
    service.from("miners").select("id, type").eq("farm_id", farmId).in("id", minerIds),
    service.from("agents").select("id, last_seen_at").eq("farm_id", farmId).order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1),
  ]);
  if (!miners || miners.length !== minerIds.length) return { ok: false, message: "Uma ou mais máquinas não pertencem a esta fazenda." };
  if (!agents?.length) return { ok: false, message: "Instale e configure um coletor antes de trocar pools." };

  const credentialsByMiner = Object.fromEntries(miners.map((miner) => {
    const type = VALID_TYPES.has(miner.type) ? miner.type : "antminer";
    return [miner.id, useDefaults ? DEFAULT_CREDENTIALS[type] : { username, password }];
  }));
  const encryptedPayload = encryptPoolCommand({ minerIds, pools, credentialsByMiner });
  const { error } = await service.from("pool_commands").insert({
    organization_id: membership.organization_id,
    farm_id: farmId,
    agent_id: agents[0].id,
    encrypted_payload: encryptedPayload,
    pool_url: pools[0].url,
    target_count: minerIds.length,
    requested_by: user.id,
  });
  if (error) return { ok: false, message: `Não foi possível criar o comando: ${error.message}` };
  revalidatePath(`/farms/${farmId}`);
  return { ok: true, message: `Troca de pool enviada para ${minerIds.length} máquina(s).` };
}
