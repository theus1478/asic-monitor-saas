export const runtime = "nodejs";

type FxData = { usd_brl: number | null; ts: number; cached: boolean };

const CACHE_TTL_MS = 5 * 60_000;
let cache: { data: FxData; ts: number } | null = null;

/** Razão BTC-em-BRL / BTC-em-USD via CoinGecko (grátis, não consome cota de nenhuma API paga). */
async function fetchRate(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,brl", { cache: "no-store" });
    const data = await res.json();
    const usd = Number(data?.bitcoin?.usd);
    const brl = Number(data?.bitcoin?.brl);
    if (Number.isFinite(usd) && Number.isFinite(brl) && usd > 0) return Math.round((brl / usd) * 10000) / 10000;
  } catch {
    // sem sorte, devolve null e o cliente decide o que fazer
  }
  return null;
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return Response.json({ ...cache.data, cached: true });
  const rate = await fetchRate();
  const data: FxData = { usd_brl: rate, ts: Date.now(), cached: false };
  if (rate != null) cache = { data, ts: Date.now() };
  return Response.json(data);
}
