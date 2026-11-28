/**
 * Deal Studio's numbers (2026-11-28): the deal of a result worked again as the person changes the price, the
 * timeline, the target or the assumptions, in the browser, with the same engine the server used. Nothing here asks
 * the server, an AI or a data provider: it is arithmetic on what the result already holds.
 *
 * What never changes here is the resale value. It is what the analysis found (after the planned renovation for a
 * full analysis, fully renovated for Quick numbers: DealResult.resaleBasis). A price, a month or a rate says nothing
 * about what the house sells for, so none of them moves it.
 *
 * A result can be worked again only when it carries the terms it was worked out with (DealResult.terms) and those
 * terms give back its own profit. A deal saved before the terms were kept, or one whose numbers do not come back,
 * opens as it was analysed and cannot be changed (the owner's decision of 2026-11-28).
 *
 * Pure: no React, no network.
 */
import type { DealInputs, DealResult, Report } from "./types";
import { costsAt, evaluateDeal } from "./deal";
import { withGate } from "./gate";

/** What the person can change in PR 1 of Deal Studio. Rates are fractions (0.11 = 11%). */
export interface StudioInputs {
  /** The price paid. */
  purchase: number;
  /** Months from purchase to sale. */
  months: number;
  /** The profit the maximum offer is solved for. */
  targetProfit: number;
  /** Annual interest rate. */
  rate: number;
  /** Loan-to-cost: the share of purchase and renovation the lender funds. */
  ltc: number;
  /** Loan points, as a fraction of the loan. */
  points: number;
  /** Taxes, insurance and utilities a month. */
  monthlyHolding: number;
  /** Buying costs, as a fraction of the price. */
  closingBuyPct: number;
  /** Selling costs including commissions, as a fraction of the resale. */
  closingSellPct: number;
  /** The reserve added to the renovation for what photos cannot show. */
  reserve: number;
}

/** The range each input may take: the sliders' and fields' bounds, and what the server accepts (lib/api/scenario.ts). */
export const STUDIO_BOUNDS: Record<keyof StudioInputs, { min: number; max: number }> = {
  purchase: { min: 0, max: 50_000_000 },
  months: { min: 1, max: 36 },
  targetProfit: { min: 0, max: 10_000_000 },
  rate: { min: 0, max: 0.4 },
  ltc: { min: 0, max: 1 },
  points: { min: 0, max: 0.1 },
  monthlyHolding: { min: 0, max: 100_000 },
  closingBuyPct: { min: 0, max: 0.1 },
  closingSellPct: { min: 0, max: 0.15 },
  reserve: { min: 0, max: 1 },
};

export const STUDIO_KEYS = Object.keys(STUDIO_BOUNDS) as (keyof StudioInputs)[];

/** Each input held inside its bounds; months a whole number. */
export function clampInputs(x: StudioInputs): StudioInputs {
  const out = { ...x };
  for (const k of STUDIO_KEYS) {
    const { min, max } = STUDIO_BOUNDS[k];
    const v = Number.isFinite(out[k]) ? out[k] : min;
    out[k] = Math.min(max, Math.max(min, v));
  }
  out.months = Math.round(out.months);
  return out;
}

/** Two sets of inputs that work out the same deal (to the cent, and to a ten-thousandth of a rate). */
export function sameInputs(a: StudioInputs, b: StudioInputs): boolean {
  return STUDIO_KEYS.every((k) => Math.abs(a[k] - b[k]) < (k === "purchase" || k === "targetProfit" || k === "monthlyHolding" ? 0.005 : 0.000_05));
}

/** A result's deal as Deal Studio can work it again, or why it cannot. */
export type StudioBase =
  | { editable: true; inputs: StudioInputs; rehab: number; resale: number }
  | { editable: false; why: "saved-before" | "numbers-differ" | "no-deal" };

/**
 * The inputs the result's own deal was worked out with, checked: worked again, they must give back its profit to the
 * dollar. Otherwise the Studio would open on numbers that are not the result's.
 */
export function studioBase(report: Report | null | undefined): StudioBase {
  const deal = report?.deal;
  if (!deal || !Number.isFinite(deal.arv) || !Number.isFinite(deal.profit) || !Number.isFinite(deal.purchasePrice)) return { editable: false, why: "no-deal" };
  const t = deal.terms;
  if (!t || !t.financing) return { editable: false, why: "saved-before" };
  const inputs: StudioInputs = {
    purchase: deal.purchasePrice,
    months: t.holdingMonths,
    targetProfit: t.targetProfit,
    rate: t.financing.rate,
    ltc: t.financing.ltc,
    points: t.financing.points,
    monthlyHolding: t.monthlyHolding,
    closingBuyPct: t.closingBuyPct,
    closingSellPct: t.closingSellPct,
    reserve: t.hiddenRiskReserve,
  };
  if (!STUDIO_KEYS.every((k) => Number.isFinite(inputs[k])) || !Number.isFinite(t.rehab)) return { editable: false, why: "numbers-differ" };
  const again = evaluateDeal(deal.arv, dealInputs(t.rehab, inputs));
  if (Math.abs(again.profit - deal.profit) > 1 || Math.abs(again.maxAllowableOffer - deal.maxAllowableOffer) > 1) return { editable: false, why: "numbers-differ" };
  return { editable: true, inputs, rehab: t.rehab, resale: deal.arv };
}

/** The engine's own inputs from the Studio's. `rehab` is the base renovation, before the reserve. */
export function dealInputs(rehab: number, x: StudioInputs): DealInputs {
  return {
    askingPrice: x.purchase,
    rehab,
    hiddenRiskReserve: x.reserve,
    holdingMonths: x.months,
    monthlyHolding: x.monthlyHolding,
    financing: { rate: x.rate, ltc: x.ltc, points: x.points },
    closingBuyPct: x.closingBuyPct,
    closingSellPct: x.closingSellPct,
    targetProfit: x.targetProfit,
  };
}

export interface LiveNumbers {
  /** The deal at these inputs, on the result's own resale value. */
  deal: DealResult;
  /** Profit ÷ the resale value. Null when there is no resale value to divide by. */
  margin: number | null;
  /** Profit ÷ the total project cost (a different figure from the margin). */
  roiOnCost: number | null;
  /** Profit ÷ the cash put in (DealResult.roi). Null when no cash goes in. */
  roiOnCash: number | null;
  /** The cash the project needs from the buyer: every cost paid before the sale, less what the lender funds. */
  cashNeeded: number;
  /** One month more than planned: the profit then, and what the month costs. */
  oneMoreMonth: { profit: number; cost: number };
  /** The downside (resale 10% lower, the work 20% higher) with one more month on top. */
  downsideWithMonth: number;
}

const ratio = (a: number, b: number) => (b > 0 && Number.isFinite(a) ? a / b : null);

/** True when the price is the analysed one (within half a dollar): only then is it called the asking price. */
export const isAskingPrice = (price: number, asking: number | undefined) => asking === undefined || Math.abs(price - asking) < 0.5;

/**
 * The deal at the given inputs, on the given resale value, with the figures the Studio shows beside it. `asking`: the
 * analysed price; a different price is called "your price" in the deciding sentence, never the asking price.
 */
export function liveNumbers(rehab: number, resale: number, x: StudioInputs, asking?: number): LiveNumbers {
  const d = dealInputs(rehab, x);
  const deal = evaluateDeal(resale, d, { price: isAskingPrice(x.purchase, asking) ? "Asking" : "Your price" });
  const loan = x.ltc * (x.purchase + deal.rehabWithReserve);
  const cashNeeded = deal.totalCost - deal.closingSell - loan;
  const longer = { ...d, holdingMonths: x.months + 1 };
  const month = costsAt(x.purchase, resale, deal.rehabWithReserve, longer).profit;
  const downsideWithMonth = costsAt(x.purchase, resale * 0.9, deal.rehabWithReserve * 1.2, longer).profit;
  return {
    deal,
    margin: ratio(deal.profit, resale),
    roiOnCost: ratio(deal.profit, deal.totalCost),
    roiOnCash: Number.isFinite(deal.roi) ? deal.roi : null,
    cashNeeded,
    oneMoreMonth: { profit: month, cost: deal.profit - month },
    downsideWithMonth,
  };
}

/**
 * The result with the live deal in place of the analysed one. What the resale value is (after the plan or fully
 * renovated) is carried over. On real sold prices the same gate as the server's applies, so a live deal is never a GO
 * there either (lib/engine/gate.ts): CHECK FIRST with its reasons. A demo keeps its verdict and its DEMO mark.
 */
export function liveReport(report: Report, live: DealResult, opts: { demo: boolean }): Report {
  const deal: DealResult = { ...live, resaleBasis: report.deal.resaleBasis, fullyRenovated: report.deal.fullyRenovated, belowPar: report.deal.belowPar };
  const next: Report = { ...report, deal };
  return opts.demo ? next : withGate(next, { areaTested: false, price: isAskingPrice(live.purchasePrice, report.deal.purchasePrice) ? "asking" : "your price" });
}
