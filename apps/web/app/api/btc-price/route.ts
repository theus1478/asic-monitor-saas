import { createServiceClient } from "../../../lib/supabase/service";

export const runtime = "nodejs";

type PriceData = {
  currency: string; price: number | null; source: string | null;
  change24hPct: number | null; ts: number; ok: boolean; note: string | null; cached: boolean;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: PriceData; ts: number }>();

async function getApiNinjasKey(): Promise<string | null> {
  try {
    const service = createServiceClient();
    const { data } = await service.from("platform_settings").select("api_ninjas_key").eq("id", true).maybeSingle();
    return data?.api_ninjas_key || null;
  } catch {
    return null;
  }
}

async function coingecko(cur: "usd" | "brl") {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${cur}&include_24hr_change=true`, { cache: "no-store" });
    const data = await res.json();
    const b = data?.bitcoin ?? {};
    const price = Number(b[cur]);
    const change = Number(b[`${cur}_24h_change`]);
    return { price: Number.isFinite(price) ? price : null, change: Number.isFinite(change) ? change : null };
  } catch {
    return { price: null, change: null };
  }
}

async function ninjasUsd(key: string) {
  try {
    const res = await fetch("https://api.api-ninjas.com/v1/bitcoin", { headers: { "X-Api-Key": key }, cache: "no-store" });
    if (!res.ok) return { price: null, change: null };
    const data = await res.json();
    const price = Number(data.price);
    const change = Number(data["24h_price_change_percent"]);
    return { price: Number.isFinite(price) ? price : null, change: Number.isFinite(change) ? change : null };
  } catch {
    return { price: null, change: null };
  }
}

async function ninjasUsdt(key: string) {
  try {
    const res = await fetch("https://api.api-ninjas.com/v1/cryptoprice?symbol=BTCUSDT", { headers: { "X-Api-Key": key }, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const price = Number(data.price);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function fetchFor(cur: string, apiKey: string | null): Promise<PriceData> {
  const base: PriceData = { currency: cur, price: null, source: null, change24hPct: null, ts: Date.now(), ok: false, note: null, cached: false };

  if (cur === "BRL") {
    const { price, change } = await coingecko("brl");
    return price != null ? { ...base, price, change24hPct: change, source: "coingecko", ok: true } : { ...base, note: "CoinGecko indisponível — informe manualmente" };
  }

  if (cur === "USD") {
    if (apiKey) {
      const { price, change } = await ninjasUsd(apiKey);
      if (price != null) return { ...base, price, change24hPct: change, source: "api-ninjas", ok: true };
    }
    const { price, change } = await coingecko("usd");
    if (price != null) return { ...base, price, change24hPct: change, source: "coingecko", ok: true, note: apiKey ? "API-Ninjas indisponível — usando CoinGecko" : "Sem chave da API-Ninjas cadastrada — usando CoinGecko" };
    return { ...base, note: "Indisponível — informe manualmente" };
  }

  if (cur === "USDT") {
    if (apiKey) {
      const price = await ninjasUsdt(apiKey);
      if (price != null) return { ...base, price, source: "api-ninjas", ok: true };
    }
    const { price } = await coingecko("usd");
    if (price != null) return { ...base, price, source: "≈ USD", ok: true, note: "Par BTCUSDT indisponível — aproximado pelo USD" };
    return { ...base, note: "Indisponível — informe manualmente" };
  }

  return base;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const currency = (url.searchParams.get("currency") ?? "BRL").toUpperCase();
  if (!["BRL", "USD", "USDT"].includes(currency)) return Response.json({ error: "Moeda inválida." }, { status: 400 });

  const cached = cache.get(currency);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return Response.json({ ...cached.data, cached: true });

  const apiKey = await getApiNinjasKey();
  const data = await fetchFor(currency, apiKey);
  if (data.ok) cache.set(currency, { data, ts: Date.now() });
  return Response.json(data);
}
