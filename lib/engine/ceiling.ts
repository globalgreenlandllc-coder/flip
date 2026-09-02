import type { CeilingResult, MarketConfig, PropertyFacts, Sale } from "./types";
import { monthsBetween, weightedPercentile } from "./math";
import { timeAdjust } from "./comps";

const RENOVATED_TIERS = new Set(["updated", "renovated"]);

/**
 * The top of the market for this submarket: the 90th percentile $/sqft
 * among renovated sales in the last 12 months, recency-weighted.
 * No finish level pushes a house past this number, so it caps ARV and
 * tells the user how much renovation the block will actually pay for.
 */
export function neighborhoodCeiling(
  subject: PropertyFacts,
  sales: Sale[],
  asOf: string,
  cfg: MarketConfig,
  minSample = 5,
): CeilingResult | null {
  const items = [];
  for (const sale of sales) {
    if (sale.submarket !== subject.submarket) continue;
    if (!RENOVATED_TIERS.has(sale.condition)) continue;
    const monthsAgo = monthsBetween(sale.saleDate, asOf);
    if (monthsAgo < 0 || monthsAgo > 12) continue;
    const price = timeAdjust(sale.price, monthsAgo, cfg.monthlyAppreciation);
    items.push({ value: price / sale.sqft, weight: Math.exp(-monthsAgo / 9) });
  }
  if (items.length < minSample) return null;
  const pricePerSqft = weightedPercentile(items, 0.9);
  return { pricePerSqft, value: pricePerSqft * subject.sqft, sampleSize: items.length };
}
