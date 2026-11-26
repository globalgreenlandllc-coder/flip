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
 * How much of a lot counts toward the price (MarketConfig.lotTaper): all of
 * the first part, a share of the next, a small share of the rest. An acre
 * beside a quarter acre is worth more, not four times the land.
 */
export function countedLotSqft(lotSqft: number, cfg: MarketConfig): number {
  const { fullUpTo, partUpTo, partShare, restShare } = cfg.lotTaper;
  const lot = Math.max(0, lotSqft);
  return Math.min(lot, fullUpTo) + partShare * Math.max(0, Math.min(lot, partUpTo) - fullUpTo) + restShare * Math.max(0, lot - partUpTo);
}

/**
 * Appraiser-style line adjustments. Positive amount means the subject is
 * superior to the comp, so the comp price is adjusted UP to match.
 *
 * Only what both sides say is compared. A fact one of them does not give
 * (a garage's size in a public record, the condition a house sold in) makes
 * no adjustment at all and is named in `notCompared`: guessing it would put
 * a made-up difference into a real price.
 */
export function compareToComp(
  subject: PropertyFacts,
  subjectCondition: Condition,
  sale: Sale,
  timeAdjustedPrice: number,
  cfg: MarketConfig,
): { adjustments: Adjustment[]; notCompared: string[] } {
  const adjustments: Adjustment[] = [{ factor: "living sqft", amount: (subject.sqft - sale.sqft) * cfg.pricePerSqftLiving }];
  const notCompared: string[] = [];
  const line = (factor: string, mine: number | null, theirs: number | null, amount: (mine: number, theirs: number) => number) => {
    if (mine === null || theirs === null) notCompared.push(factor);
    else adjustments.push({ factor, amount: amount(mine, theirs) });
  };
  line("lot sqft", subject.lotSqft, sale.lotSqft, (mine, theirs) => (countedLotSqft(mine, cfg) - countedLotSqft(theirs, cfg)) * cfg.pricePerSqftLot);
  line("beds", subject.beds, sale.beds, (mine, theirs) => (mine - theirs) * cfg.perBed);
  line("baths", subject.baths, sale.baths, (mine, theirs) => (mine - theirs) * cfg.perBath);
  line("garage", subject.garage, sale.garage, (mine, theirs) => (mine - theirs) * cfg.perGarage);
  line("age", subject.yearBuilt, sale.yearBuilt, (mine, theirs) => (mine - theirs) * cfg.perYearAge);
  if (sale.condition === "unknown") notCompared.push("condition");
  else adjustments.push({ factor: "condition", amount: (cfg.conditionSteps[subjectCondition] - cfg.conditionSteps[sale.condition]) * timeAdjustedPrice });
  return { adjustments: adjustments.filter((a) => a.amount !== 0), notCompared };
}

/** The adjustments alone (see compareToComp). */
export function adjustComp(subject: PropertyFacts, subjectCondition: Condition, sale: Sale, timeAdjustedPrice: number, cfg: MarketConfig): Adjustment[] {
  return compareToComp(subject, subjectCondition, sale, timeAdjustedPrice, cfg).adjustments;
}

function compWeight(c: {
  distanceMiles: number;
  /** How far "near" reaches in this search: half a mile, or more where the search itself had to go miles. */
  reachMiles: number;
  monthsAgo: number;
  grossAdjustmentPct: number;
  sqftDeltaPct: number;
}): number {
  const distance = Math.exp(-c.distanceMiles / c.reachMiles);
  const recency = Math.exp(-c.monthsAgo / 6);
  const adjustment = Math.exp(-c.grossAdjustmentPct / 0.1);
  const size = Math.exp(-c.sqftDeltaPct / 0.15);
  return distance * recency * adjustment * size;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Fewer sales than this say too little about what a square foot goes for here to call one of them odd. */
const MIN_FOR_OUTLIERS = 5;

/**
 * What a square foot usually goes for among these sales: the median over all
 * of them, not over the handful one search tier looks at. Six lot deeds on
 * one street are the majority of that street and a rarity in the mile around
 * it; the mile is what says which of them are the odd ones.
 */
export function usualPerSqft(prices: number[]): number | null {
  return prices.length >= MIN_FOR_OUTLIERS ? median(prices) : null;
}

export interface CompSelection {
  comps: CompResult[];
  criteriaUsed: CompCriteria;
  tierIndex: number;
  /** Sales that fit the tier's search and were left out all the same. */
  leftOut: { outliers: number; overAdjusted: number; lotSales: number };
}

interface Candidate {
  sale: Sale;
  monthsAgo: number;
  distanceMiles: number;
  timeAdjustedPrice: number;
}

/**
 * Select and adjust comps for the subject AS IF renovated (that is what
 * ARV means), widening the search progressively until we have enough.
 *
 * A sale whose price per square foot is far from what the sales given went
 * for (MarketConfig.outlierBand, usualPerSqft) is left out before anything
 * else: real records carry transfers that were never a market price.
 */
export function selectComps(
  subject: PropertyFacts,
  sales: Sale[],
  asOf: string,
  cfg: MarketConfig,
  subjectCondition: Condition = "renovated",
  tiers: CompCriteria[] = RELAXATION_TIERS,
): CompSelection {
  let best: CompSelection | null = null;

  // Each sale's age, distance and price are worked out once; the tiers only choose among them.
  const all: Candidate[] = [];
  for (const sale of sales) {
    if (sale.id === subject.id) continue;
    if (!(sale.sqft > 0) || !(sale.price > 0)) continue;
    const monthsAgo = monthsBetween(sale.saleDate, asOf);
    if (!(monthsAgo >= 0)) continue;
    all.push({ sale, monthsAgo, distanceMiles: haversineMiles(subject.lat, subject.lng, sale.lat, sale.lng), timeAdjustedPrice: timeAdjust(sale.price, monthsAgo, cfg.monthlyAppreciation) });
  }
  const perSqft = (c: Candidate) => c.timeAdjustedPrice / c.sale.sqft;
  const [tooLow, tooHigh] = cfg.outlierBand;
  const usual = usualPerSqft(all.map(perSqft));

  for (let tier = 0; tier < tiers.length; tier++) {
    const criteria = tiers[tier];
    const pool = all.filter((c) => c.monthsAgo <= criteria.months && c.distanceMiles <= criteria.radiusMiles && Math.abs(c.sale.sqft - subject.sqft) / subject.sqft <= criteria.sqftTolerance);
    const leftOut = { outliers: 0, overAdjusted: 0, lotSales: 0 };
    const candidates: CompResult[] = [];

    for (const c of pool) {
      // The sale of the lot a house was then built on (MarketConfig.lotSaleBelow), which a record shows as the house's own.
      if (usual !== null && cfg.lotSaleBelow !== null && c.sale.yearBuilt !== null && Number(c.sale.saleDate.slice(0, 4)) <= c.sale.yearBuilt && perSqft(c) < usual * cfg.lotSaleBelow) {
        leftOut.lotSales++;
        continue;
      }
      if (usual !== null && (perSqft(c) < usual * tooLow || perSqft(c) > usual * tooHigh)) {
        leftOut.outliers++;
        continue;
      }
      const { sale, monthsAgo, distanceMiles, timeAdjustedPrice } = c;
      const { adjustments, notCompared } = compareToComp(subject, subjectCondition, sale, timeAdjustedPrice, cfg);
      const netAdjustment = adjustments.reduce((s, a) => s + a.amount, 0);
      const gross = adjustments.reduce((s, a) => s + Math.abs(a.amount), 0);
      const grossAdjustmentPct = gross / timeAdjustedPrice;
      // Two big offsetting adjustments look clean and are actually two guesses stacked.
      if (grossAdjustmentPct > cfg.grossAdjustmentCap) {
        leftOut.overAdjusted++;
        continue;
      }

      candidates.push({
        sale,
        distanceMiles,
        monthsAgo,
        timeAdjustedPrice,
        adjustments,
        notCompared,
        netAdjustment,
        grossAdjustmentPct,
        adjustedPrice: timeAdjustedPrice + netAdjustment,
        weight: compWeight({ distanceMiles, reachMiles: Math.max(0.5, criteria.radiusMiles / 5), monthsAgo, grossAdjustmentPct, sqftDeltaPct: Math.abs(sale.sqft - subject.sqft) / subject.sqft }),
      });
    }

    candidates.sort((a, b) => b.weight - a.weight);
    const comps = candidates.slice(0, cfg.maxComps);
    const selection = { comps, criteriaUsed: criteria, tierIndex: tier, leftOut };
    if (comps.length >= cfg.minComps) return selection;
    if (!best || comps.length > best.comps.length) best = selection;
  }

  return best ?? { comps: [], criteriaUsed: tiers[tiers.length - 1], tierIndex: tiers.length - 1, leftOut: { outliers: 0, overAdjusted: 0, lotSales: 0 } };
}
