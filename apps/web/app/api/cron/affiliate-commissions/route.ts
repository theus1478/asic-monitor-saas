import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/service";
import { releaseMaturedCommissions } from "../../../../lib/affiliate";

/**
 * Libera (PENDING -> AVAILABLE) as comissões de afiliado cujo período de
 * carência de 30 dias já passou. A Vercel chama esta rota uma vez por dia
 * (ver vercel.json). Também é chamada "de reforço" toda vez que alguém abre
 * o painel de afiliados ou o painel admin, então esse cron é um backstop —
 * não é a única forma de a transição acontecer.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = createServiceClient();
  const released = await releaseMaturedCommissions(service);
  return NextResponse.json({ ok: true, released });
}
