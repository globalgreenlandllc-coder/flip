import { estimateArv } from "./arv";
import { evaluateDeal } from "./deal";
import { rehabFromCondition } from "./rehab";
import type { CompCriteria, Condition, Confidence, DealInputs, LowReason, MarketConfig, PropertyFacts, Sale } from "./types";

/**
 * A first look at a home for sale, before anyone has seen its photos: what
 * homes like it have sold for around it, what a repair of the chosen size
 * would cost, and what is left at the asking price after every cost of the
 * deal. It is the full analysis's own valuation and deal math, with one
 * thing guessed instead of read: the repair. That guess is the person's own
 * (how much work they expect), never the house's, so a home that needs far
 * more than they expect looks better here than it is.
 *
 * Nothing here is a verdict. A screen says which homes are worth a closer
 * look ("hot": the target profit is reached at the asking price), which
 * could work at a lower offer ("warm"), and which do not ("cold").
 */

export type RepairLevel = "light" | "medium" | "heavy";
export const REPAIR_LEVELS: RepairLevel[] = ["light", "medium", "heavy"];

/** The repair a level stands for: the full analysis's own rates for a house in that condition (MarketConfig.rehabPerSqft). */
export const REPAIR_CONDITION: Record<RepairLevel, Condition> = { light: "average", medium: "dated", heavy: "distressed" };

/** hot: the target profit is reached at the asking price. warm: some profit, short of the target. cold: none. unknown: nothing to value it against. */
export type Heat = "hot" | "warm" | "cold" | "unknown";

export interface ScreenInput {
  /** The home, its condition set from the repair level (REPAIR_CONDITION). */
  subject: PropertyFacts;
  askingPrice: number;
  sales: Sale[];
  asOf: string;
  config: MarketConfig;
  tiers: CompCriteria[];
  /** The deal's terms, the target profit among them. */
  terms: Omit<DealInputs, "askingPrice" | "rehab">;
  /** Give the sales the value was drawn from (a closer look lists them; a first look of a whole area does not). */
  withComps?: boolean;
}

/** A sale a value was drawn from, as it is listed. */
export interface ScreenComp {
  address: string | null;
  price: number;
  saleDate: string;
  distanceMiles: number;
  /** Its price adjusted to this home (size, rooms, lot, age). */
  adjustedPrice: number;
}

export interface ScreenResult {
  heat: Heat;
  /** What homes like it sold for around it (the comps, in whatever shape they sold): null when there are none. */
  arv: { point: number; low: number; high: number; confidence: Confidence; lowBecause: LowReason[]; comps: number; radiusMiles: number; months: number } | null;
  /** The repair the level stands for, before the hidden-risk reserve. */
  rehab: { low: number; likely: number; high: number };
  /** At the asking price, after every cost of the deal. Null with no comps. */
  profit: number | null;
  /** The same with the value 10% lower and the repair 20% higher. */
  worstCaseProfit: number | null;
  /** The most that can be paid and still make the target profit. */
  maxOffer: number | null;
  /** The sales the value was drawn from, when asked for (withComps). */
  comps?: ScreenComp[];
}

/** Hot when the profit wanted is reached (to the dollar: a profit equal to the target is hot), warm with some profit short of it, cold with none. */
export function heatOf(profit: number, target: number): Exclude<Heat, "unknown"> {
  return profit >= target ? "hot" : profit > 0 ? "warm" : "cold";
}

export function screenListing(input: ScreenInput): ScreenResult {
  const { subject, askingPrice, sales, asOf, config, tiers, terms } = input;
  const rehab = rehabFromCondition(subject.condition, subject.sqft, config);
  const arv = estimateArv(subject, sales, asOf, config, { tiers });
  if (!Number.isFinite(arv.point)) return { heat: "unknown", arv: null, rehab, profit: null, worstCaseProfit: null, maxOffer: null };

  const deal = evaluateDeal(arv.point, { ...terms, askingPrice, rehab: rehab.likely });
  const heat: Heat = heatOf(deal.profit, terms.targetProfit);
  return {
    heat,
    arv: {
      point: arv.point,
      low: arv.low,
      high: arv.high,
      confidence: arv.confidence,
      lowBecause: arv.lowBecause,
      comps: arv.comps.length,
      radiusMiles: arv.criteriaUsed.radiusMiles,
      months: arv.criteriaUsed.months,
    },
    rehab,
    profit: deal.profit,
    worstCaseProfit: deal.worstCaseProfit,
    maxOffer: deal.maxAllowableOffer,
    ...(input.withComps
      ? { comps: arv.comps.map((c) => ({ address: c.sale.address ?? null, price: c.sale.price, saleDate: c.sale.saleDate, distanceMiles: Math.round(c.distanceMiles * 100) / 100, adjustedPrice: Math.round(c.adjustedPrice) })) }
      : {}),
  };
}

const HEAT_ORDER: Record<Heat, number> = { hot: 0, warm: 1, cold: 2, unknown: 3 };

/** Hot first, then warm, cold and unknown; within each, the most profit at the asking price first. */
export function byPromise<T extends { screen: ScreenResult }>(a: T, b: T): number {
  return HEAT_ORDER[a.screen.heat] - HEAT_ORDER[b.screen.heat] || (b.screen.profit ?? -Infinity) - (a.screen.profit ?? -Infinity);
}
