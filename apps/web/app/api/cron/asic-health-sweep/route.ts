import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/service";
import { sweepOfflineIncidents } from "../../../../lib/asic-alerts/offline-sweep";

/**
 * Backstop diário da varredura de ASICs offline (ver lib/asic-alerts/offline-sweep.ts).
 * A varredura já roda "de reforço" toda vez que alguém abre a Visão Geral ou
 * uma fazenda — este cron só garante que ela acontece mesmo se ninguém abrir
 * o painel naquele dia. Mesmo padrão do cron de comissões de afiliado.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = createServiceClient();
  const { data: organizations } = await service.from("organizations").select("id");
  for (const org of organizations ?? []) {
    try { await sweepOfflineIncidents(service, org.id); } catch (error) { console.error("Falha na varredura de offline (cron)", org.id, error); }
  }
  return NextResponse.json({ ok: true, organizations: organizations?.length ?? 0 });
}
