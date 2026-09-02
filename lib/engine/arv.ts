import type { ArvEstimate, Confidence, MarketConfig, PropertyFacts, Sale } from "./types";
import { selectComps } from "./comps";
import { neighborhoodCeiling } from "./ceiling";
import { weightedMedian, weightedPercentile } from "./math";

function confidenceFor(n: number, spreadPct: number, tierIndex: number): Confidence {
  if (n >= 8 && spreadPct < 0.1 && tierIndex <= 1) return "HIGH";
  if (n >= 5 && spreadPct < 0.18 && tierIndex <= 2) return "MEDIUM";
  return "LOW";
}

export function estimateArv(
  subject: PropertyFacts,
  sales: Sale[],
  asOf: string,
  cfg: MarketConfig,
): ArvEstimate {
  const { comps, criteriaUsed, tierIndex } = selectComps(subject, sales, asOf, cfg);
  const ceiling = neighborhoodCeiling(subject, sales, asOf, cfg);

  if (comps.length === 0) {
    return {
      compBased: NaN,
      point: NaN,
      low: NaN,
      high: NaN,
      spreadPct: NaN,
      confidence: "LOW",
      comps,
      criteriaUsed,
      ceiling,
      cappedByCeiling: false,
    };
  }

  const weighted = comps.map((c) => ({ value: c.adjustedPrice, weight: c.weight }));
  const compBased = weightedMedian(weighted);
  let low = weightedPercentile(weighted, 0.2);
  let high = weightedPercentile(weighted, 0.8);
  const spreadPct = (high - low) / compBased;

  let point = compBased;
  let cappedByCeiling = false;
  if (ceiling && compBased > ceiling.value) {
    point = ceiling.value;
    cappedByCeiling = true;
    high = Math.min(high, ceiling.value);
    low = Math.min(low, ceiling.value);
  }

  return {
    compBased,
    point,
    low,
    high,
    spreadPct,
    confidence: confidenceFor(comps.length, spreadPct, tierIndex),
    comps,
    criteriaUsed,
    ceiling,
    cappedByCeiling,
  };
}
