import type { ArvEstimate, CompCriteria, Confidence, LowReason, MarketConfig, PropertyFacts, Sale } from "./types";
import { RELAXATION_TIERS, selectComps } from "./comps";
import { neighborhoodCeiling } from "./ceiling";
import { weightedMedian, weightedPercentile } from "./math";

function confidenceFor(n: number, spreadPct: number, tierIndex: number, conditionKnown: boolean): Confidence {
  // Comps that do not say what shape they sold in cannot carry the top mark: the value wanted
  // is the house as renovated, and nobody knows how many of them were.
  if (n >= 8 && spreadPct < 0.1 && tierIndex <= 1) return conditionKnown ? "HIGH" : "MEDIUM";
  if (n >= 5 && spreadPct < 0.18 && tierIndex <= 2) return "MEDIUM";
  return "LOW";
}

/** Each reason a value is LOW: the three tests of confidenceFor's last step, said one by one, so that the reason given is the one that holds. */
function lowReasons(n: number, spreadPct: number, tierIndex: number): LowReason[] {
  const reasons: LowReason[] = [];
  if (n < 5) reasons.push("few");
  if (n > 0 && !(spreadPct < 0.18)) reasons.push("apart");
  if (tierIndex > 2) reasons.push("wide");
  return reasons;
}

export interface ArvOptions {
  /** The search tiers to widen through. Default: the demo's four (RELAXATION_TIERS). */
  tiers?: CompCriteria[];
}

export function estimateArv(
  subject: PropertyFacts,
  sales: Sale[],
  asOf: string,
  cfg: MarketConfig,
  opts: ArvOptions = {},
): ArvEstimate {
  const { comps, criteriaUsed, tierIndex, leftOut } = selectComps(subject, sales, asOf, cfg, "renovated", opts.tiers ?? RELAXATION_TIERS);
  let ceiling = neighborhoodCeiling(subject, sales, asOf, cfg);
  const conditionKnown = comps.every((c) => c.sale.condition !== "unknown");

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
      leftOut,
      conditionKnown,
      lowBecause: ["few"],
    };
  }

  const weighted = comps.map((c) => ({ value: c.adjustedPrice, weight: c.weight }));
  const compBased = weightedMedian(weighted);
  let low = weightedPercentile(weighted, 0.2);
  let high = weightedPercentile(weighted, 0.8);
  const spreadPct = (high - low) / compBased;

  // A ceiling drawn from every sale given in the house's zip code, whatever shape each sold in, is a rough
  // guide to where a block tops out, and the sales nearest the house are better evidence than it. Where they
  // sold above it, it says nothing about this block: it does not cap the value, and the report says the
  // ceiling is not known.
  let ceilingSetAside: ArvEstimate["ceilingSetAside"];
  if (ceiling && ceiling.basis === "all" && compBased > ceiling.value) {
    ceilingSetAside = ceiling;
    ceiling = null;
  }

  let point = compBased;
  let cappedByCeiling = false;
  if (ceiling && compBased > ceiling.value) {
    point = ceiling.value;
    cappedByCeiling = true;
    high = Math.min(high, ceiling.value);
    low = Math.min(low, ceiling.value);
  }

  const confidence = confidenceFor(comps.length, spreadPct, tierIndex, conditionKnown);
  return {
    compBased,
    point,
    low,
    high,
    spreadPct,
    confidence,
    comps,
    criteriaUsed,
    ceiling,
    cappedByCeiling,
    ...(ceilingSetAside ? { ceilingSetAside } : {}),
    leftOut,
    conditionKnown,
    lowBecause: confidence === "LOW" ? lowReasons(comps.length, spreadPct, tierIndex) : [],
  };
}
