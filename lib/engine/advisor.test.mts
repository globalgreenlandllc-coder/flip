import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, costsAt, evaluate } from "./index.ts";
import { generateMarketData } from "./synthetic.ts";
import { DEFAULT_RENOVATION_COSTS, planRenovation, scopePlan, type CategoryKey, type CategoryNeeds, type RenovationPlan, type ScopeOption } from "./renovation.ts";
import { liveNumbers, liveReport, studioBase } from "./studio.ts";
import {
  advisorBase,
  advisorLive,
  applyWholeScope,
  approachChoices,
  approachOf,
  approaches,
  belowTypical,
  bestAgainstNow,
  changeScope,
  choiceKeys,
  cleanAdvisor,
  compsAtOrAbove,
  compsCondition,
  defaultAdvisor,
  estimateFor,
  highestProfit,
  resaleIsEstimate,
  sameAdvisor,
  scopeCost,
  scopeNotes,
  scopeOf,
  type AdvisorBase,
  type ScopeMap,
} from "./advisor.ts";
import type { Report } from "./types.ts";

const ASOF = "2026-09-01";
const NEEDS: CategoryNeeds = { kitchen: "replace", baths: "refresh", flooring: "replace", paint: "refresh", exterior: "replace", landscaping: "refresh", windows: "replace", roof: "replace", electrical: "none", plumbing: "unknown", hvac: "none", basement: "replace" };

/** An analysis as the analyze route works it: a plan (with its basis), and the deal on what the plan reaches. */
function analysis(opts: { seed?: number; asking?: number; needs?: CategoryNeeds; ceilingAt?: number | null } = {}) /* ceilingAt: a fraction of the comps' value */: { report: Report; plan: RenovationPlan } {
  const { subject, sales } = generateMarketData({ seed: opts.seed ?? 11, asOf: ASOF });
  const first = evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: opts.asking ?? 420_000 } });
  // A ceiling placed where the test wants it (null: none), or the market's own.
  const ceiling = opts.ceilingAt === undefined ? first.arv.ceiling : opts.ceilingAt === null ? null : { pricePerSqft: 1, value: first.arv.compBased * opts.ceilingAt, sampleSize: 30, basis: "renovated" as const };
  const plan = planRenovation({ subject, currentCondition: subject.condition, needs: opts.needs ?? NEEDS, arvPoint: first.arv.compBased, ceiling, config: DEFAULT_MARKET_CONFIG });
  const report = evaluate({
    subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG,
    deal: { ...DEFAULT_DEAL_TERMS, askingPrice: opts.asking ?? 420_000, rehab: plan.rehab.likely },
    resale: { afterPlan: plan.afterPlanValue!, leftBelowPar: plan.leftBelowPar ?? [] },
  });
  return { report, plan };
}

function baseOf(a: { report: Report; plan: RenovationPlan }): AdvisorBase {
  const s = studioBase(a.report);
  assert.ok(s.editable);
  if (!s.editable) throw new Error("not editable");
  const r = advisorBase(a.report, a.plan, s);
  if (!r.ok) throw new Error(`no advisor: ${r.why}`);
  return r.base;
}

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

test("advisor: the analysis' scope gives back the analysis' renovation, resale and deal to the cent", () => {
  for (const seed of [3, 11, 21, 42]) {
    const a = analysis({ seed });
    const base = baseOf(a);
    const s = studioBase(a.report);
    if (!s.editable) return;
    const now = advisorLive(base, s.inputs, defaultAdvisor(base));
    assert.ok(near(now.cost.rehab, a.plan.rehab.likely), "renovation");
    assert.ok(near(now.resale, a.report.deal.arv), "resale");
    assert.ok(near(now.live.deal.profit, a.report.deal.profit), "profit");
    assert.ok(near(now.live.deal.maxAllowableOffer, a.report.deal.maxAllowableOffer), "max offer");
    assert.equal(scopeOf(base, base.advised), a.plan, "the analysis' own plan, reasons and all");
  }
});

test("advisor: scopeValue of the advised scope = the plan's value added; any scope's resale stays within the fully renovated value and the ceiling", () => {
  // The market's own ceiling, none, one just under the comps' value (it binds) and one well under it (it binds hard).
  for (const ceilingAt of [undefined, null, 0.97, 0.9]) {
    const a = analysis({ ceilingAt });
    const base = baseOf(a);
    assert.ok(near(scopeOf(base, base.advised).totals.valueAdded, a.plan.totals.valueAdded));
    const keys = choiceKeys(base.basis);
    const options: ScopeOption[] = ["skip", "refresh", "replace"];
    for (let n = 0; n < 3 ** keys.length; n++) {
      const choices: ScopeMap = {};
      let m = n;
      for (const k of keys) {
        choices[k] = options[m % 3];
        m = Math.floor(m / 3);
      }
      const est = estimateFor(base, choices);
      assert.ok(est <= base.fullValue + 0.01, "never above the fully renovated value");
      if (base.basis.cap !== null) assert.ok(est <= base.basis.cap + 0.01, "never above the ceiling");
      assert.ok(est >= Math.min(base.basis.asIsValue, base.basis.cap ?? Infinity) - 0.01, "never below the as-is value (or the ceiling, where that is lower)");
    }
    const premium = estimateFor(base, approachChoices(base, "premium"));
    assert.ok(premium <= a.report.deal.fullyRenovated! + 0.01, "Premium ≤ the report's fully renovated value");
  }
});

test("advisor: a cost typed or a crew discount changes the renovation and the profit, never the resale", () => {
  const a = analysis();
  const base = baseOf(a);
  const s = studioBase(a.report);
  if (!s.editable) return;
  const first = advisorLive(base, s.inputs, defaultAdvisor(base));
  const kitchen = first.cost.lines.find((l) => l.key === "kitchen")!;
  const edited = advisorLive(base, s.inputs, cleanAdvisor(base, { ...defaultAdvisor(base), costs: [{ key: "kitchen", action: kitchen.action, cost: 12_345 }] }));
  assert.equal(edited.resale, first.resale);
  assert.ok(near(edited.cost.rehab, first.cost.rehab - kitchen.standard + 12_345));
  const crew = advisorLive(base, s.inputs, cleanAdvisor(base, { ...defaultAdvisor(base), crewPct: 0.2 }));
  assert.equal(crew.resale, first.resale);
  assert.ok(near(crew.cost.rehab, first.cost.rehab * 0.8, 0.05), "20% off every line not typed by hand");
  assert.ok(crew.live.deal.profit > first.live.deal.profit);
  // A typed cost is the person's own price: the crew discount does not apply to it.
  const both = scopeCost(first.plan, { costs: [{ key: "kitchen", action: kitchen.action, cost: 10_000 }], crewPct: 0.5 });
  assert.equal(both.lines.find((l) => l.key === "kitchen")!.used, 10_000);
});

test("advisor: a line switched off keeps the resale and opens the review; a whole scope applies its estimate", () => {
  const a = analysis();
  const base = baseOf(a);
  const start = defaultAdvisor(base);
  const off = changeScope(base, start, { ...start.choices, kitchen: "skip" });
  assert.equal(off.reviewOpen, true);
  assert.equal(off.resale.basis, "kept");
  assert.equal(off.resale.value, base.resale, "the resale stays the analysis' value");
  assert.ok(estimateFor(base, off.choices) < base.resale, "the estimate for the smaller scope is lower");
  // Back on the analysis' scope: nothing to review.
  const back = changeScope(base, off, { ...off.choices, kitchen: start.choices.kitchen });
  assert.equal(back.reviewOpen, false);
  assert.equal(back.resale.basis, "analysis");
  // An approach applies its estimate and keeps the review open.
  const cosmetic = applyWholeScope(base, start, approachChoices(base, "cosmetic"));
  assert.equal(cosmetic.resale.basis, "estimate");
  assert.ok(near(cosmetic.resale.value, estimateFor(base, approachChoices(base, "cosmetic"))));
  assert.equal(cosmetic.reviewOpen, true);
  // A line changed after an estimate keeps that value as "kept".
  const after = changeScope(base, cosmetic, { ...cosmetic.choices, paint: "skip" });
  assert.equal(after.resale.basis, "kept");
  assert.equal(after.resale.value, cosmetic.resale.value);
  assert.equal(applyWholeScope(base, cosmetic, approachChoices(base, "ready")).resale.basis, "analysis");
});

test("advisor: systems and parts not in the photos cannot be switched off", () => {
  const a = analysis();
  const base = baseOf(a);
  const keys = choiceKeys(base.basis);
  assert.ok(!keys.includes("roof") && !keys.includes("plumbing"), "the roof (a system) and plumbing (not seen) are not choices");
  const tried = scopePlan(base.basis, { roof: "skip", plumbing: "skip" } as ScopeMap, { mode: "chosen" });
  assert.equal(tried.items.find((i) => i.key === "roof")!.action, "required");
  assert.equal(tried.items.find((i) => i.key === "plumbing")!.action, "inspect");
  const cleaned = cleanAdvisor(base, { ...defaultAdvisor(base), choices: { ...base.advised, roof: "skip" } as ScopeMap });
  assert.equal((cleaned.choices as Record<string, unknown>).roof, undefined);
});

test("advisor: each approach card's numbers are liveNumbers on its own renovation and resale; Market-ready is the analysis", () => {
  const a = analysis();
  const base = baseOf(a);
  const s = studioBase(a.report);
  if (!s.editable) return;
  const cards = approaches(base, s.inputs, 0.1);
  for (const c of cards) {
    const again = liveNumbers(c.rehab, c.resale, s.inputs);
    assert.ok(near(again.deal.profit, c.live.deal.profit));
    assert.ok(near(c.rehab, scopeCost(scopeOf(base, c.choices), { costs: [], crewPct: 0.1 }).rehab));
  }
  const ready = cards.find((c) => c.id === "ready")!;
  assert.equal(ready.resale, base.resale);
  assert.equal(ready.estimated, base.analysisEstimated);
  assert.ok(cards.filter((c) => c.id !== "ready").every((c) => c.estimated));
});

test("advisor: Market-ready's resale is an ESTIMATE exactly when the analysis' plan leaves part of the house below par at a cost", () => {
  const seen = new Set<boolean>();
  for (const seed of [3, 11, 21, 42]) {
    for (const ceilingAt of [undefined, null, 0.97, 0.9] as const) {
      for (const needs of [NEEDS, { ...NEEDS, kitchen: "refresh", flooring: "refresh", windows: "refresh", exterior: "refresh" } as CategoryNeeds]) {
        const a = analysis({ seed, ceilingAt, needs });
        const s = studioBase(a.report);
        if (!s.editable) continue;
        const r = advisorBase(a.report, a.plan, s);
        if (!r.ok) continue;
        const base = r.base;
        assert.equal(base.analysisEstimated, a.report.deal.belowPar === "costs", `seed ${seed}, ceiling ${ceilingAt}`);
        assert.equal(base.analysisEstimated, base.resale < base.fullValue - 0.5);
        seen.add(base.analysisEstimated);
        const d = defaultAdvisor(base);
        assert.equal(approaches(base, s.inputs, 0).find((c) => c.id === "ready")!.estimated, base.analysisEstimated);
        assert.equal(resaleIsEstimate(base, d), base.analysisEstimated, "the analysis' resale, as the deal shows it");
        assert.equal(resaleIsEstimate(base, changeScope(base, d, { ...d.choices, kitchen: "skip" })), base.analysisEstimated, "the analysis' value kept");
        assert.equal(resaleIsEstimate(base, applyWholeScope(base, d, approachChoices(base, "premium"))), onAdvised(base, approachChoices(base, "premium")) ? base.analysisEstimated : true);
        assert.equal(resaleIsEstimate(base, { ...d, resale: { basis: "mine", value: 1 } }), false, "a typed resale is the person's");
      }
    }
  }
  assert.deepEqual([...seen].sort(), [false, true], "both cases came up");
});

const onAdvised = (base: AdvisorBase, choices: ScopeMap) => choiceKeys(base.basis).every((k) => (choices[k] ?? "skip") === (base.advised[k] ?? "skip"));

test("advisor: a cost below the typical range is allowed on any line, a locked one too, and named on the deal and in the best scope", () => {
  const a = analysis();
  const base = baseOf(a);
  const s = studioBase(a.report);
  if (!s.editable) return;
  const first = advisorLive(base, s.inputs, defaultAdvisor(base));
  const roof = first.cost.lines.find((l) => l.key === "roof")!;
  assert.equal(roof.action, "required", "the roof is a system: it cannot be switched off");
  assert.ok(roof.costLow > 0);
  assert.deepEqual(belowTypical(first.cost.lines), [], "the standard costs are within the typical range");
  const state = cleanAdvisor(base, { ...defaultAdvisor(base), costs: [{ key: "roof", action: "required", cost: 0 }] });
  const now = advisorLive(base, s.inputs, state);
  assert.ok(near(now.cost.rehab, first.cost.rehab - roof.standard), "the $0 is used");
  assert.equal(now.resale, first.resale, "and the resale does not move");
  assert.deepEqual(belowTypical(now.cost.lines), [{ key: "roof", label: roof.label, cost: 0, low: roof.costLow, high: roof.costHigh, typed: true }]);
  // The deal says it (the decision card reads it from here) ...
  const shown = liveReport(a.report, now.live.deal, { demo: true, scope: scopeNotes(base, state, now) });
  assert.deepEqual(shown.deal.costsBelowTypical?.map((l) => l.key), ["roof"]);
  // ... and so does the best scope that rests on it (the roof is in every scope).
  const best = highestProfit(base, s.inputs, state);
  assert.ok(best.belowTypical.some((l) => l.key === "roof" && l.typed));
  assert.deepEqual(highestProfit(base, s.inputs, defaultAdvisor(base)).belowTypical, []);
  // The crew discount can take lines there too, said apart from a typed cost; it goes up to 50%.
  const crew = advisorLive(base, s.inputs, cleanAdvisor(base, { ...defaultAdvisor(base), crewPct: 0.5 }));
  const low = belowTypical(crew.cost.lines);
  assert.ok(low.length > 0 && low.every((l) => !l.typed && l.cost < l.low));
  assert.equal(approaches(base, s.inputs, 0.5).find((c) => c.id === "ready")!.belowTypical.length, low.length);
  assert.equal(cleanAdvisor(base, { ...defaultAdvisor(base), crewPct: 0.8 }).crewPct, 0.5);
});

test("advisor: a typed resale above the fully renovated value never makes a GO, on demo numbers either", () => {
  const a = analysis({ asking: 150_000 });
  const base = baseOf(a);
  const s = studioBase(a.report);
  if (!s.editable) return;
  for (const [value, demo] of [[base.fullValue * 1.5, true], [base.fullValue * 1.5, false], [base.fullValue, true]] as const) {
    const state = cleanAdvisor(base, { ...defaultAdvisor(base), resale: { basis: "mine", value }, reviewOpen: false });
    const now = advisorLive(base, s.inputs, state);
    assert.equal(now.live.deal.verdict, "GO", "the deal math says GO at this price");
    const shown = liveReport(a.report, now.live.deal, { demo, scope: scopeNotes(base, state, now) }).deal;
    const above = value > base.fullValue + 0.5;
    if (above || !demo) assert.equal(shown.verdict, "CHECK FIRST");
    else assert.equal(shown.verdict, "GO", "on demo numbers a resale at the fully renovated value stays a GO");
    assert.equal(shown.withheld?.some((r) => r.code === "RESALE_ABOVE_FULL") ?? false, above);
    if (!demo) assert.ok(shown.withheld?.some((r) => r.code === "AREA_UNTESTED"));
  }
});

test("advisor: the best scope is compared with the scope now like with like (both on their estimated resale)", () => {
  const a = analysis();
  const base = baseOf(a);
  const s = studioBase(a.report);
  if (!s.editable) return;
  const d = defaultAdvisor(base);
  const best = highestProfit(base, s.inputs, d);
  const plain = bestAgainstNow(base, s.inputs, d, best);
  assert.equal(plain.nowOnEstimate, true);
  assert.ok(near(plain.profit, best.live.deal.profit - advisorLive(base, s.inputs, d).live.deal.profit, 1));
  // A typed resale far above: the gain is still against the scope's estimate, and it says the deal uses another resale.
  const mine = { ...d, resale: { basis: "mine" as const, value: base.fullValue * 1.4 } };
  const vs = bestAgainstNow(base, s.inputs, mine, best);
  assert.equal(vs.nowOnEstimate, false);
  assert.ok(near(vs.profit, plain.profit, 1), "the typed resale does not enter the comparison");
});

test("advisor: when two approaches are the same scope, Market-ready (the analysis) is the one named", () => {
  const base = baseOf(analysis());
  const same: AdvisorBase = { ...base, advised: approachChoices(base, "cosmetic") };
  assert.equal(approachOf(same, same.advised), "ready");
  assert.equal(approachOf(base, approachChoices(base, "premium")), onAdvised(base, approachChoices(base, "premium")) ? "ready" : "premium");
});

test("advisor: how the comps were adjusted for condition is read off the sales themselves", () => {
  const comps = analysis().report.arv.comps;
  assert.equal(compsCondition(comps).adjusted, "all", "the demo's sales say their condition");
  const none = comps.map((c) => ({ ...c, sale: { ...c.sale, condition: "unknown" as const } }));
  assert.deepEqual(compsCondition(none), { adjusted: "none", withCondition: 0, total: comps.length });
  const some = comps.map((c, i) => (i === 0 ? none[0] : c));
  assert.equal(compsCondition(some).adjusted, comps.length > 1 ? "some" : "none");
});

test("advisor: 'Find highest profit' is the true maximum at the person's price (checked against every scope, value-less parts included)", () => {
  for (const [seed, asking, crew] of [[11, 420_000, 0], [3, 380_000, 0.15], [21, 500_000, 0.3]] as const) {
    const a = analysis({ seed, asking });
    const base = baseOf(a);
    const s = studioBase(a.report);
    if (!s.editable) return;
    const state = { costs: [], crewPct: crew };
    const best = highestProfit(base, s.inputs, state);
    const keys = choiceKeys(base.basis);
    const options: ScopeOption[] = ["skip", "refresh", "replace"];
    let max = -Infinity;
    for (let n = 0; n < 3 ** keys.length; n++) {
      const choices: ScopeMap = {};
      let m = n;
      for (const k of keys) {
        choices[k] = options[m % 3];
        m = Math.floor(m / 3);
      }
      const plan = scopeOf(base, choices);
      const rehab = scopeCost(plan, state).rehab;
      const resale = Math.min(plan.afterPlanValue!, base.fullValue);
      const p = costsAt(s.inputs.purchase, resale, rehab * (1 + s.inputs.reserve), { ...DEFAULT_DEAL_TERMS, askingPrice: s.inputs.purchase, rehab, hiddenRiskReserve: s.inputs.reserve, holdingMonths: s.inputs.months, monthlyHolding: s.inputs.monthlyHolding, financing: { rate: s.inputs.rate, ltc: s.inputs.ltc, points: s.inputs.points }, closingBuyPct: s.inputs.closingBuyPct, closingSellPct: s.inputs.closingSellPct, targetProfit: s.inputs.targetProfit }).profit;
      max = Math.max(max, p);
    }
    assert.ok(near(best.live.deal.profit, max, 0.5), `best ${best.live.deal.profit} vs max ${max}`);
    for (const c of approaches(base, s.inputs, crew)) assert.ok(best.live.deal.profit >= c.live.deal.profit - 0.5, `not below ${c.id}`);
  }
});

test("advisor: no advisor for Quick numbers, a plan saved before it, or a plan whose numbers do not come back", () => {
  const a = analysis();
  const s = studioBase(a.report);
  if (!s.editable) return;
  assert.deepEqual(advisorBase(a.report, null, s), { ok: false, why: "no-plan" });
  const { basis: _b, ...old } = a.plan;
  void _b;
  assert.deepEqual(advisorBase(a.report, old, s), { ok: false, why: "saved-before" });
  assert.deepEqual(advisorBase(a.report, a.plan, { rehab: s.rehab + 500, resale: s.resale }), { ok: false, why: "numbers-differ" });
});

test("advisor: comps at or above a value count the adjusted prices", () => {
  const a = analysis();
  const comps = a.report.arv.comps;
  const top = Math.max(...comps.map((c) => c.adjustedPrice));
  assert.deepEqual(compsAtOrAbove(comps, top), { atOrAbove: 1, total: comps.length });
  assert.equal(compsAtOrAbove(comps, 0).atOrAbove, comps.length);
});

test("advisor: sameAdvisor tells a changed state from the analysis'", () => {
  const base = baseOf(analysis());
  const d = defaultAdvisor(base);
  assert.equal(sameAdvisor(base, d, defaultAdvisor(base)), true);
  assert.equal(sameAdvisor(base, d, { ...d, crewPct: 0.1 }), false);
  assert.equal(sameAdvisor(base, d, changeScope(base, d, { ...d.choices, kitchen: "skip" })), false);
  void (DEFAULT_RENOVATION_COSTS as Record<CategoryKey, unknown>);
});
