import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente com a service_role key: ignora RLS. Uso restrito a rotas de servidor
 * que autenticam por outro meio (ex.: token do agente), nunca por sessão do usuário.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  }
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false } });
}
