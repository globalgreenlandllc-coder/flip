import type { DealInputs, DealResult, SensitivityCell, Verdict } from "./types";

const ARV_SHOCKS = [0, -0.05, -0.1];
const REHAB_SHOCKS = [0, 0.1, 0.2];

interface Costs {
  rehab: number;
  holding: number;
  financing: number;
  closingBuy: number;
  closingSell: number;
  total: number;
  profit: number;
}

/** Financing cost as a fraction of the financed amount over the hold. */
function financingFactor(d: DealInputs): number {
  return (d.financing.rate * d.holdingMonths) / 12 + d.financing.points;
}

export function costsAt(purchase: number, arv: number, rehab: number, d: DealInputs): Costs {
  const f = financingFactor(d);
  const holding = d.monthlyHolding * d.holdingMonths;
  const financing = f * d.financing.ltc * (purchase + rehab);
  const closingBuy = d.closingBuyPct * purchase;
  const closingSell = d.closingSellPct * arv;
  const total = purchase + rehab + holding + financing + closingBuy + closingSell;
  return { rehab, holding, financing, closingBuy, closingSell, total, profit: arv - total };
}

/**
 * Max allowable offer, solved in closed form. Financing and buy-side
 * closing both scale with purchase price, so the equation is circular;
 * rearranging profit = target for P gives:
 *
 *   P = [ARV(1 - cs) - rehab(1 + f*ltc) - holding - target] / (1 + cb + f*ltc)
 */
export function maxAllowableOffer(arv: number, rehab: number, d: DealInputs): number {
  const f = financingFactor(d);
  const holding = d.monthlyHolding * d.holdingMonths;
  const numerator =
    arv * (1 - d.closingSellPct) - rehab * (1 + f * d.financing.ltc) - holding - d.targetProfit;
  const denominator = 1 + d.closingBuyPct + f * d.financing.ltc;
  return numerator / denominator;
}

export function evaluateDeal(arv: number, d: DealInputs): DealResult {
  const rehab = d.rehab * (1 + d.hiddenRiskReserve);
  const base = costsAt(d.askingPrice, arv, rehab, d);
  const mao = maxAllowableOffer(arv, rehab, d);

  const sensitivity: SensitivityCell[] = [];
  for (const a of ARV_SHOCKS) {
    for (const r of REHAB_SHOCKS) {
      const c = costsAt(d.askingPrice, arv * (1 + a), rehab * (1 + r), d);
      sensitivity.push({ arvDeltaPct: a, rehabDeltaPct: r, profit: c.profit });
    }
  }
  const worstCaseProfit = Math.min(...sensitivity.map((s) => s.profit));

  // Cash the investor actually puts in: everything paid before the sale,
  // minus what the lender funds.
  const loan = d.financing.ltc * (d.askingPrice + rehab);
  const cashIn = base.total - base.closingSell - loan;
  const roi = cashIn > 0 ? base.profit / cashIn : NaN;

  let verdict: Verdict;
  let decidingFactor: string;
  const gap = d.askingPrice - mao;
  if (base.profit >= d.targetProfit && worstCaseProfit > 0) {
    verdict = "GO";
    decidingFactor = `Asking is $${fmt(-gap)} under your max offer and the deal survives ARV -10% with rehab +20%.`;
  } else if (base.profit >= d.targetProfit) {
    verdict = "TIGHT";
    decidingFactor = `Hits target at base case but loses $${fmt(-worstCaseProfit)} if ARV drops 10% and rehab runs 20% over.`;
  } else if (base.profit > 0) {
    verdict = "TIGHT";
    decidingFactor = `Profitable but $${fmt(d.targetProfit - base.profit)} short of your $${fmt(d.targetProfit)} target. Offer $${fmt(mao)} or walk.`;
  } else {
    verdict = "PASS";
    decidingFactor = `Asking is $${fmt(gap)} ABOVE your max offer of $${fmt(mao)}. Projected loss $${fmt(-base.profit)}.`;
  }

  return {
    verdict,
    decidingFactor,
    purchasePrice: d.askingPrice,
    arv,
    rehabWithReserve: rehab,
    holdingCost: base.holding,
    financingCost: base.financing,
    closingBuy: base.closingBuy,
    closingSell: base.closingSell,
    totalCost: base.total,
    profit: base.profit,
    roi,
    maxAllowableOffer: mao,
    askingVsMao: gap,
    sensitivity,
    worstCaseProfit,
  };
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
