export interface PricingTier {
  from: number;
  to?: number;
  unitPriceCents: number;
}

/** Faixas são configuradas no banco; o preço é marginal por faixa. */
export function monthlyPriceCents(machineCount: number, tiers: PricingTier[]) {
  return tiers.reduce((total, tier) => {
    const upper = tier.to ?? Number.POSITIVE_INFINITY;
    const units = Math.max(0, Math.min(machineCount, upper) - tier.from + 1);
    return total + units * tier.unitPriceCents;
  }, 0);
}
