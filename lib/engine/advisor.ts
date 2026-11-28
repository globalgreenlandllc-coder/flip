/**
 * Deal Studio's renovation advisor (2026-11-28): the analysis' plan, line by line, as something the person can change —
 * leave a part as it is, refresh it or replace it, type their own cost, say their crew is cheaper — and the deal worked
 * again from it in the browser. Three ready-made approaches (Cosmetic, Market-ready = the analysis, Premium) and the
 * scope with the highest profit at the person's price.
 *
 * Two sides, kept apart on purpose:
 *  - COST: the lines' costs, the person's own costs and the crew discount. They change the renovation and the profit,
 *    never the resale value.
 *  - RESALE: what a scope reaches is estimated with the plan's own arithmetic (renovation.ts scopePlan: the share of the
 *    uplift each part earns, the block's ceiling), never above the fully renovated value. Those shares and the condition
 *    steps are placeholders, so on real sold prices every such figure is an ESTIMATE. Changing a line does not move the
 *    resale by itself: it opens "Scope changed: review the resale", and the person takes the estimate, keeps the value or
 *    types their own. An approach card applies its estimate at once and keeps the notice open until confirmed.
 *
 * Pure: no React, no network. Nothing here asks the server, the AI or a data provider.
 */
import type { CompResult, CostBelowTypical, Report, SaleCondition } from "./types";
import { DEFAULT_RENOVATION_COSTS, isChoiceLine, scopePlan, type CategoryKey, type PlanAction, type RenovationBasis, type RenovationPlan, type ScopeOption } from "./renovation";
import { costsAt } from "./deal";
import { dealInputs, liveNumbers, type LiveNumbers, type ScopeNotes, type StudioInputs } from "./studio";

const KEYS = Object.keys(DEFAULT_RENOVATION_COSTS) as CategoryKey[];

export type ScopeMap = Partial<Record<CategoryKey, ScopeOption>>;

/** What the advisor of one result is worked from. */
export interface AdvisorBase {
  basis: RenovationBasis;
  /** The analysis' final option for every line that can be chosen. */
  advised: ScopeMap;
  /** The plan as analysed: shown, reasons and all, when the scope is the advised one. */
  analysisPlan: RenovationPlan;
  /** The fully renovated value: no scope's resale goes above it. */
  fullValue: number;
  /** The analysis' resale and base renovation (what the Studio opens on). */
  resale: number;
  rehab: number;
  /**
   * The analysis' own resale rests on the plan's placeholder shares too: its plan leaves part of the house below par
   * and the resale is under the fully renovated value. Then Market-ready's resale is an ESTIMATE like the others'.
   */
  analysisEstimated: boolean;
}

export type AdvisorBaseResult = { ok: true; base: AdvisorBase } | { ok: false; why: "no-plan" | "saved-before" | "numbers-differ" };

/** A line can be chosen when it is a part the photos show and not a system (renovation.ts isChoiceLine). */
export function choiceKeys(basis: RenovationBasis): CategoryKey[] {
  return KEYS.filter((k) => isChoiceLine(k, basis.needs[k] ?? "unknown"));
}

/** A plan's final option for each line that can be chosen: what the ceiling or a negative net skipped is "skip". */
function finalOptions(plan: RenovationPlan, keys: CategoryKey[]): ScopeMap {
  const out: ScopeMap = {};
  for (const k of keys) {
    const item = plan.items.find((i) => i.key === k);
    out[k] = item && (item.action === "refresh" || item.action === "replace") ? item.action : "skip";
  }
  return out;
}

const scopeKey = (m: ScopeMap, keys: CategoryKey[]) => keys.map((k) => m[k] ?? "skip").join(",");

/**
 * The advisor for a result, or why there is none: Quick numbers and plans saved before the advisor kept their basis
 * have none; and the advised scope must give back the analysis' own renovation and resale to the dollar, or the
 * advisor would open on numbers that are not the result's.
 */
export function advisorBase(report: Report, plan: RenovationPlan | null | undefined, studio: { rehab: number; resale: number }): AdvisorBaseResult {
  if (!plan) return { ok: false, why: "no-plan" };
  if (!plan.basis || report.deal.resaleBasis !== "after-plan") return { ok: false, why: "saved-before" };
  const basis = plan.basis;
  const keys = choiceKeys(basis);
  const advised = finalOptions(plan, keys);
  const fullValue = typeof report.deal.fullyRenovated === "number" ? report.deal.fullyRenovated : report.arv.point;
  const again = scopePlan(basis, advised, { mode: "chosen" });
  const resale = Math.min(again.afterPlanValue ?? NaN, fullValue);
  if (!(Math.abs(again.rehab.likely - studio.rehab) <= 1) || !(Math.abs(resale - studio.resale) <= 1)) return { ok: false, why: "numbers-differ" };
  return { ok: true, base: { basis, advised, analysisPlan: plan, fullValue, resale: studio.resale, rehab: studio.rehab, analysisEstimated: studio.resale < fullValue - 0.5 } };
}

/** A cost the person typed for one line, for the option it was typed for. */
export interface CostEdit {
  key: CategoryKey;
  /** The line's action when it was typed ("refresh", "replace", "required", "inspect"). */
  action: PlanAction;
  cost: number;
}

export type ResaleBasis = "analysis" | "estimate" | "kept" | "mine";

/** What the person changed in the advisor. */
export interface AdvisorState {
  choices: ScopeMap;
  costs: CostEdit[];
  /** "My crew is X% cheaper": a fraction (0.15 = 15%). It lowers the costs not typed by hand; never the resale. */
  crewPct: number;
  /**
   * The resale the deal is worked on. "analysis": the analysis' own. "estimate": the estimate for the chosen scope.
   * "kept": a value kept when the scope changed after it. "mine": typed by the person.
   */
  resale: { basis: ResaleBasis; value: number };
  /** "Scope changed: review the resale" is showing. */
  reviewOpen: boolean;
}

export const ADVISOR_BOUNDS = {
  /** "My crew is cheaper by" goes up to 50% (the screen says so). */
  crewPct: { min: 0, max: 0.5 },
  cost: { min: 0, max: 10_000_000 },
  resale: { min: 1, max: 50_000_000 },
};

export function defaultAdvisor(base: AdvisorBase): AdvisorState {
  return { choices: { ...base.advised }, costs: [], crewPct: 0, resale: { basis: "analysis", value: base.resale }, reviewOpen: false };
}

const clamp = (v: number, { min, max }: { min: number; max: number }) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);

/** The state held to what the base allows: options only on lines that can be chosen, numbers in range. */
export function cleanAdvisor(base: AdvisorBase, s: AdvisorState): AdvisorState {
  const keys = choiceKeys(base.basis);
  const choices: ScopeMap = {};
  for (const k of keys) {
    const o = s.choices[k];
    choices[k] = o === "skip" || o === "refresh" || o === "replace" ? o : (base.advised[k] ?? "skip");
  }
  const seen = new Set<string>();
  const costs = s.costs
    .filter((c) => KEYS.includes(c.key) && Number.isFinite(c.cost))
    .map((c) => ({ ...c, cost: clamp(c.cost, ADVISOR_BOUNDS.cost) }))
    .filter((c) => (seen.has(`${c.key}:${c.action}`) ? false : (seen.add(`${c.key}:${c.action}`), true)));
  const resale = s.resale.basis === "analysis" ? { basis: "analysis" as const, value: base.resale } : { basis: s.resale.basis, value: clamp(s.resale.value, ADVISOR_BOUNDS.resale) };
  return { choices, costs, crewPct: clamp(s.crewPct, ADVISOR_BOUNDS.crewPct), resale, reviewOpen: !!s.reviewOpen };
}

/** Two states that work out the same deal. */
export function sameAdvisor(base: AdvisorBase, a: AdvisorState, b: AdvisorState): boolean {
  const keys = choiceKeys(base.basis);
  const costKey = (s: AdvisorState) =>
    s.costs
      .map((c) => `${c.key}:${c.action}:${Math.round(c.cost * 100)}`)
      .sort()
      .join("|");
  return scopeKey(a.choices, keys) === scopeKey(b.choices, keys) && costKey(a) === costKey(b) && Math.abs(a.crewPct - b.crewPct) < 0.000_05 && a.resale.basis === b.resale.basis && Math.abs(a.resale.value - b.resale.value) < 0.5;
}

/** The plan for a scope: the analysis' own (reasons and all) when it is the advised one, else the person's choices. */
export function scopeOf(base: AdvisorBase, choices: ScopeMap): RenovationPlan {
  const keys = choiceKeys(base.basis);
  return scopeKey(choices, keys) === scopeKey(base.advised, keys) ? base.analysisPlan : scopePlan(base.basis, choices, { mode: "chosen" });
}

/** The estimated resale of a scope: what its work reaches, never above the fully renovated value. */
export function estimateFor(base: AdvisorBase, choices: ScopeMap): number {
  const plan = scopeOf(base, choices);
  return Math.min(plan.afterPlanValue ?? base.resale, base.fullValue);
}

/** A line of the scope that costs money, with the cost used. */
export interface CostLine {
  key: CategoryKey;
  label: string;
  action: PlanAction;
  costLow: number;
  costHigh: number;
  /** The plan's likely cost less the crew discount. */
  standard: number;
  /** The cost the person typed for this option, if any. */
  edited: number | null;
  /** What the deal uses: the typed cost, else the standard. */
  used: number;
}

const doing = (a: PlanAction, likely: number) => a === "replace" || a === "refresh" || a === "required" || (a === "inspect" && likely > 0);

/** The renovation of a scope: every line that costs money, the costs used, and their sum (before the reserve). */
export function scopeCost(plan: RenovationPlan, state: Pick<AdvisorState, "costs" | "crewPct">): { rehab: number; lines: CostLine[] } {
  const lines: CostLine[] = [];
  for (const i of plan.items) {
    if (!doing(i.action, i.costLikely)) continue;
    const edit = state.costs.find((c) => c.key === i.key && c.action === i.action);
    const standard = i.costLikely * (1 - state.crewPct);
    lines.push({ key: i.key, label: i.label, action: i.action, costLow: i.costLow, costHigh: i.costHigh, standard, edited: edit ? edit.cost : null, used: edit ? edit.cost : standard });
  }
  return { rehab: lines.reduce((s, l) => s + l.used, 0), lines };
}

/**
 * The lines whose cost used is below the typical range for the work: a cost typed by the person, or the crew discount.
 * Allowed (the owner's decision, 2026-11-28), but said plainly wherever the deal rests on it.
 */
export function belowTypical(lines: CostLine[]): CostBelowTypical[] {
  return lines.filter((l) => l.costLow > 0 && l.used < l.costLow - 0.5).map((l) => ({ key: l.key, label: l.label, cost: l.used, low: l.costLow, high: l.costHigh, typed: l.edited !== null }));
}

export interface AdvisorLive {
  plan: RenovationPlan;
  cost: { rehab: number; lines: CostLine[] };
  /** The resale the deal is worked on now (the state's). */
  resale: number;
  /** The estimate for the chosen scope (shown beside it when the scope changed). */
  estimate: number;
  live: LiveNumbers;
}

/** The deal at the person's inputs and scope. */
export function advisorLive(base: AdvisorBase, inputs: StudioInputs, state: AdvisorState, asking?: number): AdvisorLive {
  const plan = scopeOf(base, state.choices);
  const cost = scopeCost(plan, state);
  const estimate = Math.min(plan.afterPlanValue ?? base.resale, base.fullValue);
  const resale = state.resale.basis === "analysis" ? base.resale : state.resale.value;
  return { plan, cost, resale, estimate, live: liveNumbers(cost.rehab, resale, inputs, asking) };
}

export type ApproachId = "cosmetic" | "ready" | "premium";

export const APPROACHES: { id: ApproachId; label: string; blurb: string }[] = [
  { id: "cosmetic", label: "Cosmetic", blurb: "Refresh every part that needs work. Lighter and cheaper." },
  { id: "ready", label: "Market-ready", blurb: "The analysis' plan: what pays, part by part, under the block's ceiling." },
  { id: "premium", label: "Premium", blurb: "Replace every part that needs work. Go further, spend more." },
];

/** The scope of an approach: Market-ready is the analysis' own; Cosmetic refreshes and Premium replaces every part that needs work. */
export function approachChoices(base: AdvisorBase, id: ApproachId): ScopeMap {
  if (id === "ready") return { ...base.advised };
  const out: ScopeMap = {};
  for (const k of choiceKeys(base.basis)) {
    const need = base.basis.needs[k];
    out[k] = need === "refresh" || need === "replace" ? (id === "cosmetic" ? "refresh" : "replace") : "skip";
  }
  return out;
}

/** The approach the chosen scope is, if it is one. Where two approaches are the same scope, Market-ready (the analysis) wins. */
export function approachOf(base: AdvisorBase, choices: ScopeMap): ApproachId | null {
  const keys = choiceKeys(base.basis);
  const now = scopeKey(choices, keys);
  const order: ApproachId[] = ["ready", "cosmetic", "premium"];
  return order.find((id) => scopeKey(approachChoices(base, id), keys) === now) ?? null;
}

export interface ApproachNumbers {
  id: ApproachId;
  label: string;
  blurb: string;
  choices: ScopeMap;
  rehab: number;
  /** The analysis' resale for Market-ready; the estimate for the other two. */
  resale: number;
  /** An ESTIMATE (placeholder shares): always for Cosmetic and Premium; for Market-ready when the analysis' is one. */
  estimated: boolean;
  /** Lines the crew discount takes below the typical range for the work. */
  belowTypical: CostBelowTypical[];
  live: LiveNumbers;
}

/** Each approach at the person's price and assumptions, at standard costs with the crew discount (costs typed for lines are not carried over). */
export function approaches(base: AdvisorBase, inputs: StudioInputs, crewPct: number, asking?: number): ApproachNumbers[] {
  return APPROACHES.map((a) => {
    const choices = approachChoices(base, a.id);
    const plan = scopeOf(base, choices);
    const cost = scopeCost(plan, { costs: [], crewPct });
    const ready = a.id === "ready";
    const resale = ready ? base.resale : Math.min(plan.afterPlanValue ?? base.resale, base.fullValue);
    return { ...a, choices, rehab: cost.rehab, resale, estimated: !ready || base.analysisEstimated, belowTypical: belowTypical(cost.lines), live: liveNumbers(cost.rehab, resale, inputs, asking) };
  });
}

export interface BestScope {
  choices: ScopeMap;
  rehab: number;
  resale: number;
  live: LiveNumbers;
  /** How many scopes were compared. */
  compared: number;
  /** Lines of the best scope priced below the typical range for the work (typed costs or the crew discount). */
  belowTypical: CostBelowTypical[];
}

/**
 * The scope with the highest profit at the person's price, timeline and assumptions, on each scope's estimated resale:
 * every combination of skip / refresh / replace over the parts that need work and carry value (a part that adds no
 * value is left as it is), compared exactly. Ties go to the cheaper renovation. Costs typed for a line count where
 * the option is the one they were typed for; the crew discount applies to the rest.
 */
export function highestProfit(base: AdvisorBase, inputs: StudioInputs, state: Pick<AdvisorState, "costs" | "crewPct">, asking?: number): BestScope {
  const keys = choiceKeys(base.basis);
  const free = keys.filter((k) => {
    const need = base.basis.needs[k];
    return (need === "refresh" || need === "replace") && DEFAULT_RENOVATION_COSTS[k].share > 0;
  });
  const fixed: ScopeMap = {};
  for (const k of keys) if (!free.includes(k)) fixed[k] = "skip";
  const options: ScopeOption[] = ["skip", "refresh", "replace"];
  let best: { choices: ScopeMap; rehab: number; resale: number; profit: number } | null = null;
  const total = 3 ** free.length;
  const d = dealInputs(0, inputs);
  for (let n = 0; n < total; n++) {
    const choices: ScopeMap = { ...fixed };
    let m = n;
    for (const k of free) {
      choices[k] = options[m % 3];
      m = Math.floor(m / 3);
    }
    const plan = scopeOf(base, choices);
    const rehab = scopeCost(plan, state).rehab;
    const resale = Math.min(plan.afterPlanValue ?? base.resale, base.fullValue);
    const profit = costsAt(inputs.purchase, resale, rehab * (1 + inputs.reserve), { ...d, rehab }).profit;
    if (!best || profit > best.profit + 0.005 || (Math.abs(profit - best.profit) <= 0.005 && rehab < best.rehab)) best = { choices, rehab, resale, profit };
  }
  const b = best!;
  return { choices: b.choices, rehab: b.rehab, resale: b.resale, live: liveNumbers(b.rehab, b.resale, inputs, asking), compared: total, belowTypical: belowTypical(scopeCost(scopeOf(base, b.choices), state).lines) };
}

/**
 * The best scope against the scope now, like with like: the scope now on ITS estimated resale too (the best is worked
 * on its estimate). `nowOnEstimate`: false when the deal on screen uses another resale (kept or typed), so its profit
 * on screen is not the one compared.
 */
export function bestAgainstNow(base: AdvisorBase, inputs: StudioInputs, state: AdvisorState, best: BestScope, asking?: number): { profit: number; cash: number; nowOnEstimate: boolean } {
  const now = advisorLive(base, inputs, state, asking);
  const atEstimate = liveNumbers(now.cost.rehab, now.estimate, inputs, asking);
  return { profit: best.live.deal.profit - atEstimate.deal.profit, cash: best.live.cashNeeded - atEstimate.cashNeeded, nowOnEstimate: Math.abs(now.resale - now.estimate) < 1 };
}

/**
 * The resale the state uses rests on the placeholder shares (an ESTIMATE): a scope's estimate, the analysis' own when
 * it is one, or a value kept from either. A resale the person typed is theirs.
 */
export function resaleIsEstimate(base: AdvisorBase, s: AdvisorState): boolean {
  if (s.resale.basis === "mine") return false;
  if (s.resale.basis === "analysis") return base.analysisEstimated;
  // A scope's estimate is one (as its card says), the analysis' scope aside; a kept value equal to the analysis' resale
  // is the analysis' own, and any other kept value came from a scope's estimate.
  if (s.resale.basis === "estimate") return onAnalysisScope(base, s.choices) ? base.analysisEstimated : true;
  return Math.abs(s.resale.value - base.resale) < 0.5 ? base.analysisEstimated : true;
}

/** What a changed scope says about the deal (lib/engine/studio.ts liveReport), the same in the browser and on the server. */
export function scopeNotes(base: AdvisorBase, s: AdvisorState, now: AdvisorLive): ScopeNotes {
  const left = now.plan.leftBelowPar ?? [];
  const belowPar = left.length === 0 ? "none" : (now.plan.afterPlanValue ?? 0) >= base.fullValue ? "absorbed" : "costs";
  return { belowPar, resaleChoice: s.resale.basis === "analysis" ? undefined : s.resale.basis, resaleEstimated: resaleIsEstimate(base, s), costsBelowTypical: belowTypical(now.cost.lines) };
}

/** How many of the comparable sales, adjusted to this house, sold at or above a value. */
export function compsAtOrAbove(comps: CompResult[], value: number): { atOrAbove: number; total: number } {
  return { atOrAbove: comps.filter((c) => c.adjustedPrice >= value - 0.5).length, total: comps.length };
}

/**
 * How the comparable sales were adjusted for condition (comps.ts compareToComp): "all" = every sale's record says the
 * condition it sold in, so each is adjusted to this house fully renovated; "none" = no record says it (real sold prices
 * as a rule), so the sales are adjusted for size and features only; "some" = only those whose record says it.
 */
export function compsCondition(comps: CompResult[]): { adjusted: "all" | "none" | "some"; withCondition: number; total: number } {
  const withCondition = comps.filter((c) => c.sale.condition !== "unknown").length;
  return { adjusted: withCondition === 0 ? "none" : withCondition === comps.length ? "all" : "some", withCondition, total: comps.length };
}

/** The demo's comparable sales by the condition they sold in: how many, and the middle adjusted price. */
export function compsByCondition(comps: CompResult[]): { condition: SaleCondition; count: number; median: number }[] {
  const by = new Map<SaleCondition, number[]>();
  for (const c of comps) by.set(c.sale.condition, [...(by.get(c.sale.condition) ?? []), c.adjustedPrice]);
  const order: SaleCondition[] = ["distressed", "dated", "average", "updated", "renovated", "unknown"];
  return order
    .filter((k) => by.has(k))
    .map((k) => {
      const v = [...by.get(k)!].sort((a, b) => a - b);
      const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      return { condition: k, count: v.length, median };
    });
}

/** The scope in words: "kitchen replaced, baths refreshed, flooring left as it is". */
export function scopeWords(base: AdvisorBase, choices: ScopeMap): string {
  const parts: string[] = [];
  for (const k of choiceKeys(base.basis)) {
    const need = base.basis.needs[k];
    if (need !== "refresh" && need !== "replace" && (choices[k] ?? "skip") === "skip") continue;
    const o = choices[k] ?? "skip";
    parts.push(`${DEFAULT_RENOVATION_COSTS[k].label.toLowerCase()} ${o === "skip" ? "left as it is" : o === "refresh" ? "refreshed" : "replaced"}`);
  }
  return parts.join(", ");
}

/** The state is the analysis' scope at the analysis' resale (costs and crew aside). */
function onAnalysisScope(base: AdvisorBase, choices: ScopeMap): boolean {
  const keys = choiceKeys(base.basis);
  return scopeKey(choices, keys) === scopeKey(base.advised, keys);
}

/**
 * A line changed (or several, by hand): the resale is KEPT as it is and "Scope changed: review the resale" opens. A
 * resale that was the analysis' or an estimate becomes "kept", since it is no longer that scope's. Back on the
 * analysis' scope with the analysis' resale, nothing is open.
 */
export function changeScope(base: AdvisorBase, s: AdvisorState, choices: ScopeMap): AdvisorState {
  const atAnalysisResale = s.resale.basis === "analysis" || (s.resale.basis === "kept" && Math.abs(s.resale.value - base.resale) < 0.5);
  if (onAnalysisScope(base, choices) && atAnalysisResale) return { ...s, choices: { ...choices }, resale: { basis: "analysis", value: base.resale }, reviewOpen: false };
  const resale = s.resale.basis === "analysis" ? { basis: "kept" as const, value: base.resale } : s.resale.basis === "estimate" ? { basis: "kept" as const, value: s.resale.value } : s.resale;
  return { ...s, choices: { ...choices }, resale, reviewOpen: true };
}

/**
 * A whole scope applied (an approach card, or the highest-profit scope): its estimated resale is applied at once and the
 * review notice stays open until the person confirms it or types their own. The analysis' own scope takes the
 * analysis' resale back, with nothing to review.
 */
export function applyWholeScope(base: AdvisorBase, s: AdvisorState, choices: ScopeMap): AdvisorState {
  if (onAnalysisScope(base, choices)) return { ...s, choices: { ...choices }, resale: { basis: "analysis", value: base.resale }, reviewOpen: false };
  return { ...s, choices: { ...choices }, resale: { basis: "estimate", value: estimateFor(base, choices) }, reviewOpen: true };
}
