/**
 * Core domain types for the flip evaluation engine.
 * The engine is pure: no I/O, no framework imports. Everything here is
 * serializable so it can travel over the API unchanged.
 */

export type Condition = "distressed" | "dated" | "average" | "updated" | "renovated";

export interface PropertyFacts {
  id: string;
  lat: number;
  lng: number;
  /** Neighborhood / zip / tract key used for the ceiling calculation. */
  submarket: string;
  sqft: number;
  /**
   * The five below are null when they are not known. A real property record
   * does not always say them (RentCast seldom gives a garage's size), and a
   * fact that is not known is never adjusted for and never shown as a number.
   */
  lotSqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  /** Garage spaces. */
  garage: number | null;
  condition: Condition;
}

/**
 * A sold home. Its condition is "unknown" when the source is a public record:
 * that says what a house sold for and when, not what shape it was in.
 */
export type SaleCondition = Condition | "unknown";

export interface Sale extends Omit<PropertyFacts, "condition"> {
  condition: SaleCondition;
  price: number;
  /** ISO date (YYYY-MM-DD). */
  saleDate: string;
  /** Its street address, when the source gives one: a real sale is one the reader can look up. */
  address?: string;
}

/**
 * Marginal adjustment rates for one metro or submarket. These are the
 * appraiser's "paired sales" values: what one extra unit is worth at the
 * margin, NOT the average price per unit. Fit them by regression on solds.
 */
export interface MarketConfig {
  pricePerSqftLiving: number;
  /** Value of one more square foot of lot, for the part of a lot that counts in full (see lotTaper). */
  pricePerSqftLot: number;
  /**
   * How much of a lot counts. Land is not worth the same by the foot at every
   * size: the first quarter acre of a house lot is what buyers pay for, the
   * rest of an acre much less, and acreage beyond that hardly at all. So the
   * first `fullUpTo` square feet count in full, the next up to `partUpTo` at
   * `partShare`, and everything beyond at `restShare`.
   */
  lotTaper: { fullUpTo: number; partUpTo: number; partShare: number; restShare: number };
  perBed: number;
  perBath: number;
  perGarage: number;
  /** Dollar value of being one year newer. */
  perYearAge: number;
  /** Value of each condition tier as a fraction of price, relative to "average". */
  conditionSteps: Record<Condition, number>;
  /** Monthly appreciation used to time-adjust older sales, e.g. 0.004. */
  monthlyAppreciation: number;
  /** Comps whose gross adjustment exceeds this fraction are discarded. */
  grossAdjustmentCap: number;
  /**
   * A sale whose price per square foot is below the first or above the second
   * multiple of the median of all the sales given is left out: a transfer
   * inside a family for a token sum, a deed that covers several lots.
   * [low, high]. Wide enough that a street which really sells for half of
   * what its surroundings do, or twice, keeps its own sales.
   */
  outlierBand: [number, number];
  /**
   * A sale dated in the year its house was built, at under this share of the
   * usual price per square foot, is taken for the sale of the lot the house
   * was then built on: the record shows the builder's purchase until the
   * finished house sells and that sale is recorded. Null: no such rule (the
   * demo's sales are all of finished houses).
   */
  lotSaleBelow: number | null;
  minComps: number;
  maxComps: number;
  /** Rehab $/sqft by starting condition: [low, likely, high]. */
  rehabPerSqft: Record<Condition, [number, number, number]>;
}

export interface CompCriteria {
  radiusMiles: number;
  months: number;
  /** Allowed +/- fraction of subject sqft. */
  sqftTolerance: number;
}

export interface Adjustment {
  factor: string;
  amount: number;
}

export interface CompResult {
  sale: Sale;
  distanceMiles: number;
  monthsAgo: number;
  timeAdjustedPrice: number;
  adjustments: Adjustment[];
  /** What could not be compared because the subject or the sale does not say it: "garage", "condition". */
  notCompared: string[];
  netAdjustment: number;
  grossAdjustmentPct: number;
  adjustedPrice: number;
  weight: number;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface CeilingResult {
  /** 90th percentile $/sqft among the sales in the submarket that the ceiling is drawn from. */
  pricePerSqft: number;
  /** Ceiling expressed for the subject's square footage. */
  value: number;
  sampleSize: number;
  /**
   * What it is drawn from: sales known to be renovated, or, where the sales
   * do not say their condition, all of them (the top tenth of every sale is
   * where the renovated ones are).
   */
  basis: "renovated" | "all";
}

export interface ArvEstimate {
  /** Comp-based value before the ceiling is applied. */
  compBased: number;
  /** Final value after min(compBased, ceiling). */
  point: number;
  low: number;
  high: number;
  spreadPct: number;
  confidence: Confidence;
  comps: CompResult[];
  criteriaUsed: CompCriteria;
  ceiling: CeilingResult | null;
  cappedByCeiling: boolean;
  /**
   * A ceiling drawn from all the sales given in the house's zip code that the comps themselves sold
   * above. The sales nearest the house are better evidence of its block than the rest are, so such a
   * ceiling is set aside (`ceiling` is null) and kept here only to be said.
   */
  ceilingSetAside?: CeilingResult;
  /** Sales that fit the search and were left out all the same, and why. */
  leftOut: { outliers: number; overAdjusted: number; lotSales: number };
  /** False when the comps do not say what condition they sold in, so none was adjusted for it. */
  conditionKnown: boolean;
  /** Why the confidence is LOW: each reason that holds. Empty when it is not LOW. */
  lowBecause: LowReason[];
}

/** Why a value is low-confidence: fewer than five comps ("few"), comps whose prices lie far apart ("apart"), or comps that had to be looked for far away or long ago ("wide"). */
export type LowReason = "few" | "apart" | "wide";

export interface Financing {
  /** Annual interest rate, e.g. 0.11. */
  rate: number;
  /** Loan-to-cost: fraction of (purchase + rehab) financed. */
  ltc: number;
  /** Origination points as a fraction, e.g. 0.02. */
  points: number;
}

export interface DealInputs {
  askingPrice: number;
  /** Base rehab before the hidden-risk reserve is applied. */
  rehab: number;
  /** Fraction added to rehab for what photos cannot show. Default 0.12. */
  hiddenRiskReserve: number;
  holdingMonths: number;
  /** Taxes, insurance, utilities per month. */
  monthlyHolding: number;
  financing: Financing;
  /** Buy-side closing as fraction of purchase price. */
  closingBuyPct: number;
  /** Sell-side closing incl. commissions as fraction of ARV. */
  closingSellPct: number;
  targetProfit: number;
}

/**
 * CHECK FIRST is not a result of the deal math. It stands in for a GO that
 * may not be given yet (lib/engine/gate.ts): the numbers work, and something
 * outside them is still open.
 */
export type Verdict = "GO" | "TIGHT" | "PASS" | "CHECK FIRST";

/** Why a GO was withheld. */
export interface GateReason {
  code: "AREA_UNTESTED" | "LOW_CONFIDENCE";
  /** What is open, in plain words. */
  message: string;
  /** What would clear it. */
  clears: string;
}

export interface SensitivityCell {
  arvDeltaPct: number;
  rehabDeltaPct: number;
  profit: number;
}

export interface DealResult {
  verdict: Verdict;
  /** The single number that decided the verdict, in plain words. */
  decidingFactor: string;
  purchasePrice: number;
  arv: number;
  rehabWithReserve: number;
  holdingCost: number;
  financingCost: number;
  closingBuy: number;
  closingSell: number;
  totalCost: number;
  profit: number;
  /** Profit / cash-equivalent cost basis. */
  roi: number;
  maxAllowableOffer: number;
  /** The profit the max offer was solved for. Absent on deals saved before 2026-11-28 (they did not keep it). */
  targetProfit?: number;
  askingVsMao: number;
  sensitivity: SensitivityCell[];
  worstCaseProfit: number;
  /** Set when the deal math said GO and the verdict shown is CHECK FIRST: the reasons a GO was withheld. */
  withheld?: GateReason[];
  /**
   * Which resale value `arv` is (2026-11-28): "after-plan" = what the planned renovation reaches (a full analysis);
   * "fully-renovated" = the comps' renovated value, the work taken as bringing the house up to them (Quick numbers).
   * Absent on deals saved before 2026-11-28: their `arv` is the fully renovated value.
   */
  resaleBasis?: "after-plan" | "fully-renovated";
  /** The comps' fully renovated value, for comparison with `arv`. Absent on deals saved before 2026-11-28. */
  fullyRenovated?: number;
  /**
   * With "after-plan": "none" = the plan brings every part the photos show below par up to par; "absorbed" = it leaves
   * parts below par but the block's ceiling stops the value there anyway; "costs" = what it leaves costs resale.
   */
  belowPar?: "none" | "absorbed" | "costs";
}

export interface RehabRange {
  low: number;
  likely: number;
  high: number;
}

export interface RiskFlag {
  code: string;
  message: string;
  /**
   * What the flag was worked out from, when the caller knows: the photos, the
   * listing, a number sent with the request, the provider's property record,
   * or the sales. The engine does not set it; the route that knows where
   * each input came from does.
   */
  basis?: "photos" | "listing" | "caller" | "record" | "sales";
}

export interface Report {
  subject: PropertyFacts;
  asOf: string;
  arv: ArvEstimate;
  rehab: RehabRange;
  deal: DealResult;
  riskFlags: RiskFlag[];
  /** Plain-language reasons, in the order they should be read. */
  narrative: string[];
}
