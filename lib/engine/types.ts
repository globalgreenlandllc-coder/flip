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
  lotSqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  /** Garage spaces. */
  garage: number;
  condition: Condition;
}

export interface Sale extends PropertyFacts {
  price: number;
  /** ISO date (YYYY-MM-DD). */
  saleDate: string;
}

/**
 * Marginal adjustment rates for one metro or submarket. These are the
 * appraiser's "paired sales" values: what one extra unit is worth at the
 * margin, NOT the average price per unit. Fit them by regression on solds.
 */
export interface MarketConfig {
  pricePerSqftLiving: number;
  pricePerSqftLot: number;
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
  netAdjustment: number;
  grossAdjustmentPct: number;
  adjustedPrice: number;
  weight: number;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface CeilingResult {
  /** 90th percentile $/sqft among renovated sales in the submarket. */
  pricePerSqft: number;
  /** Ceiling expressed for the subject's square footage. */
  value: number;
  sampleSize: number;
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
}

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

export type Verdict = "GO" | "TIGHT" | "PASS";

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
  askingVsMao: number;
  sensitivity: SensitivityCell[];
  worstCaseProfit: number;
}

export interface RehabRange {
  low: number;
  likely: number;
  high: number;
}

export interface RiskFlag {
  code: string;
  message: string;
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
