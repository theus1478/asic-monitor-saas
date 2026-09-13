import { hashAgentToken } from "../../../../lib/agent-token";
import { createServiceClient } from "../../../../lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) {
    return Response.json({ error: "Token do agente ausente." }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    return Response.json({ error: "Supabase não configurado no servidor." }, { status: 503 });
  }

  const tokenHash = hashAgentToken(token);
  const { data: agent } = await supabase
    .from("agents")
    .select("id, farm_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!agent) {
    return Response.json({ error: "Token inválido." }, { status: 401 });
  }

  const { data: miners } = await supabase
    .from("miners")
    .select("name, ip, protocol_port, type")
    .eq("farm_id", agent.farm_id)
    .eq("enabled", true);

  return Response.json({
    miners: (miners ?? []).map((m) => ({ name: m.name, ip: m.ip, port: m.protocol_port, type: m.type })),
    poll_interval_seconds: 30,
  });
}
