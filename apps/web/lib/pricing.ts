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

/** USDT (Binance-Peg, 18 casas decimais) na BNB Smart Chain. */
export const BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_CHAIN_ID = 56;

/**
 * URI de transferência de token (EIP-681) para carteiras BSC — mesmo formato
 * que o BitCart devolve em `payment_url`. O valor exato é o que identifica a
 * fatura (todas usam o mesmo endereço), por isso vai pré-preenchido no QR.
 */
export function buildBscUsdtUri(amountUsdt: number, destinationAddress: string) {
  const wei = BigInt(Math.round(amountUsdt * 1_000_000)) * 10n ** 12n;
  return `ethereum:${BSC_USDT_CONTRACT}@${BSC_CHAIN_ID}/transfer?address=${destinationAddress}&uint256=${wei.toString()}`;
}
