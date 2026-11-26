import type { CompCriteria, DealInputs, MarketConfig } from "./types";

/**
 * PLACEHOLDER adjustment rates. Every number here must be fit per metro by
 * regressing sold price on characteristics within each submarket before
 * anyone pays for a report. pricePerSqftLiving is the marginal rate and
 * is normally well below average $/sqft.
 */
export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  pricePerSqftLiving: 140,
  pricePerSqftLot: 4,
  // A quarter acre in full, the rest of an acre at a quarter, acreage beyond at a twentieth.
  // Placeholders like the rates: an acre next to a quarter acre once threw out four comps of five.
  lotTaper: { fullUpTo: 10_000, partUpTo: 43_560, partShare: 0.25, restShare: 0.05 },
  perBed: 8_000,
  perBath: 12_000,
  perGarage: 10_000,
  perYearAge: 500,
  conditionSteps: {
    distressed: -0.2,
    dated: -0.1,
    average: 0,
    updated: 0.06,
    renovated: 0.12,
  },
  monthlyAppreciation: 0.003,
  grossAdjustmentCap: 0.25,
  // Wide on purpose. A street can honestly sell for half of what the mile around it does, or for twice: those
  // sales are the house's best comps and must stay. A deed for a fifth of the going rate, or five times it, is
  // not a price anybody paid for a house like this one.
  outlierBand: [0.25, 4],
  lotSaleBelow: null,
  minComps: 5,
  maxComps: 8,
  rehabPerSqft: {
    distressed: [55, 75, 100],
    dated: [30, 42, 60],
    average: [18, 25, 35],
    updated: [8, 12, 18],
    renovated: [3, 5, 8],
  },
};

/**
 * The same placeholder rates for real sold prices, with two differences.
 *
 * An older sale is taken at the price it sold for. The demo's +0.3% a month
 * is a number the made-up market was built with; nobody has measured what
 * this area did, and a rate nobody measured must not raise a real estimate.
 * The accuracy step fits it, with the others.
 *
 * And a rule the demo has no need of. A new house's record shows the
 * builder's purchase of the lot until the finished house sells and that sale
 * is recorded: a "sale" in the year the house was built, for a third of what
 * such a house goes for. Six of those on a new street would be the nearest
 * comps of every house on it. A finished house does not sell for under half
 * the going rate in the year it was built.
 */
export const REAL_SALES_CONFIG: MarketConfig = { ...DEFAULT_MARKET_CONFIG, monthlyAppreciation: 0, lotSaleBelow: 0.5 };

/**
 * How far the search for comparable sales widens when the sales are real
 * records. The last step is for the country: where a mile holds five sales a
 * year, the nearest five like the house are miles and many months away, and
 * an answer from them is marked low-confidence. (The demo keeps the four
 * steps it has always had: RELAXATION_TIERS in comps.ts.)
 */
export const REAL_SALES_TIERS: CompCriteria[] = [
  { radiusMiles: 0.5, months: 6, sqftTolerance: 0.2 },
  { radiusMiles: 1.0, months: 9, sqftTolerance: 0.25 },
  { radiusMiles: 1.0, months: 12, sqftTolerance: 0.3 },
  { radiusMiles: 2.5, months: 18, sqftTolerance: 0.35 },
  { radiusMiles: 5.0, months: 24, sqftTolerance: 0.4 },
];

export const DEFAULT_DEAL_TERMS: Omit<DealInputs, "askingPrice" | "rehab"> = {
  hiddenRiskReserve: 0.12,
  holdingMonths: 6,
  monthlyHolding: 1_400,
  financing: { rate: 0.11, ltc: 0.85, points: 0.02 },
  closingBuyPct: 0.015,
  closingSellPct: 0.07,
  targetProfit: 60_000,
};
