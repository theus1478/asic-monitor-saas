export interface PricingTier {
  from: number;
  to?: number;
  unitPriceCents: number;
}

/**
 * Faixas padrão de US$/máquina/mês. Configurável futuramente pelo painel
 * admin; hoje vive só no código.
 */
export const DEFAULT_PRICING_TIERS: PricingTier[] = [
  { from: 1, unitPriceCents: 100 },
];

export function monthlyPriceCents(machineCount: number, tiers: PricingTier[] = DEFAULT_PRICING_TIERS) {
  return tiers.reduce((total, tier) => {
    const upper = tier.to ?? Number.POSITIVE_INFINITY;
    const units = Math.max(0, Math.min(machineCount, upper) - tier.from + 1);
    return total + units * tier.unitPriceCents;
  }, 0);
}

export function averageUnitPriceCents(machineCount: number, tiers: PricingTier[] = DEFAULT_PRICING_TIERS) {
  if (machineCount <= 0) return tiers[0]?.unitPriceCents ?? 0;
  return monthlyPriceCents(machineCount, tiers) / machineCount;
}

/** Mint oficial do USDT (Tether) na rede Solana. */
export const SOLANA_USDT_MINT = process.env.NEXT_PUBLIC_SOLANA_USDT_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const BILLING_WALLET_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_BILLING_WALLET_PUBLIC_KEY ?? "HixKsNWU1Zv4mtajtecLdXYiXLvsNHdpjSSGwXdJkpWn";

/**
 * Adiciona uma fração de centavo pseudoaleatória e determinística ao valor
 * base, pra cada cobrança pedir um valor exato diferente das outras. É o
 * mesmo truque que Coinbase Commerce, BTCPay etc. usam: identifica quem
 * pagou pelo valor exato recebido, sem depender de memo — funciona mesmo
 * quando o cliente saca direto de uma exchange (Binance etc.), que não deixa
 * anexar memo/tag num saque de Solana.
 */
export function withUniqueAmountTail(baseAmountUsdt: number, seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const tail = (hash % 9900) + 1; // 1..9900 -> 0.000001 a 0.0099 USDT
  return Math.round((baseAmountUsdt + tail / 1_000_000) * 1_000_000) / 1_000_000;
}

/**
 * Monta um Solana Pay Transfer Request URI apontando para o endereço de
 * depósito exclusivo da fatura (ver lib/solana-wallet.ts). O endereço sozinho
 * já identifica o cliente, então o memo aqui é só um reforço opcional — segue
 * incluído porque carteiras compatíveis com Solana Pay o preenchem de graça,
 * mas saques diretos de exchange (sem suporte a memo) pagam normalmente.
 */
export function buildSolanaPayUri(amountUsdt: number, reference: string, destinationAddress: string) {
  const params = new URLSearchParams({
    amount: amountUsdt.toFixed(6),
    "spl-token": SOLANA_USDT_MINT,
    label: "ASIC Monitor Cloud",
    message: `Assinatura mensal — ref. ${reference}`,
    memo: reference,
  });
  return `solana:${destinationAddress}?${params.toString()}`;
}
