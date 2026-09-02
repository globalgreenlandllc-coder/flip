import type {
  Adjustment,
  CompCriteria,
  CompResult,
  Condition,
  MarketConfig,
  PropertyFacts,
  Sale,
} from "./types";
import { haversineMiles, monthsBetween } from "./math";

/**
 * Search tiers, tightest first. We stop at the first tier that yields
 * at least config.minComps surviving comps. Relaxing further than the
 * last tier means the answer is not trustworthy and confidence says so.
 */
export const RELAXATION_TIERS: CompCriteria[] = [
  { radiusMiles: 0.5, months: 6, sqftTolerance: 0.2 },
  { radiusMiles: 1.0, months: 9, sqftTolerance: 0.25 },
  { radiusMiles: 1.5, months: 12, sqftTolerance: 0.3 },
  { radiusMiles: 2.5, months: 18, sqftTolerance: 0.35 },
];

export function timeAdjust(price: number, monthsAgo: number, monthlyAppreciation: number): number {
  return price * (1 + monthlyAppreciation) ** Math.max(0, monthsAgo);
}

/**
 * Appraiser-style line adjustments. Positive amount means the subject is
 * superior to the comp, so the comp price is adjusted UP to match.
 */
export function adjustComp(
  subject: PropertyFacts,
  subjectCondition: Condition,
  sale: Sale,
  timeAdjustedPrice: number,
  cfg: MarketConfig,
): Adjustment[] {
  const adj: Adjustment[] = [
    { factor: "living sqft", amount: (subject.sqft - sale.sqft) * cfg.pricePerSqftLiving },
    { factor: "lot sqft", amount: (subject.lotSqft - sale.lotSqft) * cfg.pricePerSqftLot },
    { factor: "beds", amount: (subject.beds - sale.beds) * cfg.perBed },
    { factor: "baths", amount: (subject.baths - sale.baths) * cfg.perBath },
    { factor: "garage", amount: (subject.garage - sale.garage) * cfg.perGarage },
    { factor: "age", amount: (subject.yearBuilt - sale.yearBuilt) * cfg.perYearAge },
    {
      factor: "condition",
      amount:
        (cfg.conditionSteps[subjectCondition] - cfg.conditionSteps[sale.condition]) *
        timeAdjustedPrice,
    },
  ];
  return adj.filter((a) => a.amount !== 0);
}

function compWeight(c: {
  distanceMiles: number;
  monthsAgo: number;
  grossAdjustmentPct: number;
  sqftDeltaPct: number;
}): number {
  const distance = Math.exp(-c.distanceMiles / 0.5);
  const recency = Math.exp(-c.monthsAgo / 6);
  const adjustment = Math.exp(-c.grossAdjustmentPct / 0.1);
  const size = Math.exp(-c.sqftDeltaPct / 0.15);
  return distance * recency * adjustment * size;
}

export interface CompSelection {
  comps: CompResult[];
  criteriaUsed: CompCriteria;
  tierIndex: number;
}

/**
 * Select and adjust comps for the subject AS IF renovated (that is what
 * ARV means), widening the search progressively until we have enough.
 */
export function selectComps(
  subject: PropertyFacts,
  sales: Sale[],
  asOf: string,
  cfg: MarketConfig,
  subjectCondition: Condition = "renovated",
): CompSelection {
  let best: CompSelection | null = null;

  for (let tier = 0; tier < RELAXATION_TIERS.length; tier++) {
    const criteria = RELAXATION_TIERS[tier];
    const candidates: CompResult[] = [];

    for (const sale of sales) {
      if (sale.id === subject.id) continue;
      const monthsAgo = monthsBetween(sale.saleDate, asOf);
      if (monthsAgo < 0 || monthsAgo > criteria.months) continue;
      const distanceMiles = haversineMiles(subject.lat, subject.lng, sale.lat, sale.lng);
      if (distanceMiles > criteria.radiusMiles) continue;
      const sqftDeltaPct = Math.abs(sale.sqft - subject.sqft) / subject.sqft;
      if (sqftDeltaPct > criteria.sqftTolerance) continue;

      const timeAdjustedPrice = timeAdjust(sale.price, monthsAgo, cfg.monthlyAppreciation);
      const adjustments = adjustComp(subject, subjectCondition, sale, timeAdjustedPrice, cfg);
      const netAdjustment = adjustments.reduce((s, a) => s + a.amount, 0);
      const gross = adjustments.reduce((s, a) => s + Math.abs(a.amount), 0);
      const grossAdjustmentPct = gross / timeAdjustedPrice;
      // Two big offsetting adjustments look clean and are actually two guesses stacked.
      if (grossAdjustmentPct > cfg.grossAdjustmentCap) continue;

      candidates.push({
        sale,
        distanceMiles,
        monthsAgo,
        timeAdjustedPrice,
        adjustments,
        netAdjustment,
        grossAdjustmentPct,
        adjustedPrice: timeAdjustedPrice + netAdjustment,
        weight: compWeight({ distanceMiles, monthsAgo, grossAdjustmentPct, sqftDeltaPct }),
      });
    }

    candidates.sort((a, b) => b.weight - a.weight);
    const comps = candidates.slice(0, cfg.maxComps);
    const selection = { comps, criteriaUsed: criteria, tierIndex: tier };
    if (comps.length >= cfg.minComps) return selection;
    if (!best || comps.length > best.comps.length) best = selection;
  }

  return best ?? { comps: [], criteriaUsed: RELAXATION_TIERS[RELAXATION_TIERS.length - 1], tierIndex: RELAXATION_TIERS.length - 1 };
}
