import type { CeilingResult, MarketConfig, PropertyFacts, Sale } from "./types";
import { monthsBetween, weightedPercentile } from "./math";
import { timeAdjust, usualPerSqft } from "./comps";

const RENOVATED_TIERS = new Set(["updated", "renovated"]);

/** A top tenth needs ten to be drawn from: with fewer sales of unknown condition, the "90th percentile" is just the dearest one. */
const MIN_SAMPLE_ALL = 10;

/**
 * The top of the market for this submarket: the 90th percentile $/sqft
 * among renovated sales in the last 12 months, recency-weighted.
 * No finish level pushes a house past this number, so it caps ARV and
 * tells the user how much renovation the block will actually pay for.
 *
 * Where the sales do not say what condition they sold in (public records),
 * it is drawn from all of them instead: the top tenth of every sale is where
 * the renovated ones are. That takes more sales to mean anything, and the
 * ones whose price per square foot is far from the rest (not market prices)
 * are left out first, or a single odd deed would be the ceiling.
 */
export function neighborhoodCeiling(
  subject: PropertyFacts,
  sales: Sale[],
  asOf: string,
  cfg: MarketConfig,
  minSample = 5,
): CeilingResult | null {
  const known: { value: number; weight: number }[] = [];
  const unknown: { value: number; weight: number }[] = [];
  for (const sale of sales) {
    if (sale.submarket !== subject.submarket) continue;
    if (!(sale.sqft > 0) || !(sale.price > 0)) continue;
    if (sale.condition !== "unknown" && !RENOVATED_TIERS.has(sale.condition)) continue;
    const monthsAgo = monthsBetween(sale.saleDate, asOf);
    if (!(monthsAgo >= 0) || monthsAgo > 12) continue;
    const price = timeAdjust(sale.price, monthsAgo, cfg.monthlyAppreciation);
    (sale.condition === "unknown" ? unknown : known).push({ value: price / sale.sqft, weight: Math.exp(-monthsAgo / 9) });
  }

  // Sales known to be renovated are the ceiling's own evidence; where there are enough of them, they are all it uses.
  if (known.length >= minSample) {
    const pricePerSqft = weightedPercentile(known, 0.9);
    return { pricePerSqft, value: pricePerSqft * subject.sqft, sampleSize: known.length, basis: "renovated" };
  }
  if (unknown.length === 0) return null;

  const usual = usualPerSqft(unknown.map((i) => i.value));
  const [tooLow, tooHigh] = cfg.outlierBand;
  const items = [...known, ...unknown.filter((i) => usual === null || (i.value >= usual * tooLow && i.value <= usual * tooHigh))];
  if (items.length < Math.max(minSample, MIN_SAMPLE_ALL)) return null;
  const pricePerSqft = weightedPercentile(items, 0.9);
  return { pricePerSqft, value: pricePerSqft * subject.sqft, sampleSize: items.length, basis: "all" };
}
