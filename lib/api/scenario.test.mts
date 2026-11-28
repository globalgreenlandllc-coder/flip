import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate, withGate } from "../engine/index.ts";
import { generateMarketData } from "../engine/synthetic.ts";
import { liveNumbers, studioBase } from "../engine/studio.ts";
import { planRenovation, type RenovationPlan } from "../engine/renovation.ts";
import { advisorBase, approachChoices, defaultAdvisor, estimateFor } from "../engine/advisor.ts";
import { readScenario, scenarioFor } from "./scenario.ts";
import type { Report } from "../engine/types.ts";

const ASOF = "2026-09-01";
const NOW = new Date("2026-11-28T10:00:00Z");

function report(asking = 420_000): Report {
  const { subject, sales } = generateMarketData({ seed: 11, asOf: ASOF });
  return evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: asking, rehab: 70_000 } });
}

function inputsOf(r: Report) {
  const base = studioBase(r);
  assert.ok(base.editable);
  if (!base.editable) throw new Error("not editable");
  return base;
}

test("scenario: the analysis' own inputs keep no scenario", () => {
  const r = report();
  const res = scenarioFor(r, inputsOf(r).inputs, { demo: true, now: NOW });
  assert.deepEqual(res, { ok: true, scenario: null });
});

test("scenario: changed inputs are kept with numbers the server worked out from them", () => {
  const r = report();
  const base = inputsOf(r);
  const mine = { ...base.inputs, purchase: 380_000, months: 8, rate: 0.1 };
  const res = scenarioFor(r, mine, { demo: true, now: NOW });
  assert.ok(res.ok && res.scenario);
  if (!res.ok || !res.scenario) return;
  assert.equal(res.scenario.v, 1);
  assert.deepEqual(res.scenario.inputs, mine);
  const live = liveNumbers(base.rehab, base.resale, mine);
  assert.equal(res.scenario.snapshot.profit, live.deal.profit);
  assert.equal(res.scenario.snapshot.maxOffer, live.deal.maxAllowableOffer);
  assert.equal(res.scenario.snapshot.cashNeeded, live.cashNeeded);
  assert.equal(res.scenario.savedAt, NOW.toISOString());
});

test("scenario: numbers sent by a browser are never taken — anything but the inputs is refused", () => {
  const r = report();
  const base = inputsOf(r);
  const res = scenarioFor(r, { ...base.inputs, purchase: 300_000, profit: 9_999_999 }, { demo: true, now: NOW });
  assert.equal(res.ok, false);
});

test("scenario: inputs that are not numbers, or out of range, are refused in words", () => {
  const r = report();
  const base = inputsOf(r);
  for (const bad of [null, "x", [], { ...base.inputs, purchase: "380000" }, { ...base.inputs, months: 0 }, { ...base.inputs, rate: 2 }, { ...base.inputs, purchase: Number.POSITIVE_INFINITY }, { purchase: 1 }]) {
    const res = scenarioFor(r, bad, { demo: true, now: NOW });
    assert.equal(res.ok, false, JSON.stringify(bad));
    if (!res.ok) assert.match(res.error, /could not be read/);
  }
});

test("scenario: a deal saved before its terms were kept cannot take one", () => {
  const r = report();
  const base = inputsOf(r);
  const { terms: _t, ...old } = r.deal;
  void _t;
  const res = scenarioFor({ ...r, deal: old }, { ...base.inputs, purchase: 300_000 }, { demo: true, now: NOW });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /saved before RenoFlip kept its assumptions/);
});

test("scenario: on real sold prices a scenario's verdict is never a GO", () => {
  const r = withGate(report(), { areaTested: false });
  const base = inputsOf(r);
  const res = scenarioFor(r, { ...base.inputs, purchase: 150_000 }, { demo: false, now: NOW });
  assert.ok(res.ok && res.scenario);
  if (res.ok && res.scenario) assert.equal(res.scenario.snapshot.verdict, "CHECK FIRST");
  const demo = scenarioFor(r, { ...base.inputs, purchase: 150_000 }, { demo: true, now: NOW });
  if (demo.ok && demo.scenario) assert.equal(demo.scenario.snapshot.verdict, "GO");
});

test("scenario: a stored scenario reads back as its inputs; anything else reads as none", () => {
  const r = report();
  const base = inputsOf(r);
  const mine = { ...base.inputs, purchase: 390_000 };
  const res = scenarioFor(r, mine, { demo: true, now: NOW });
  assert.ok(res.ok && res.scenario);
  // A version 1 scenario (Studio part 1) still opens: its inputs, on the analysis' scope.
  if (res.ok && res.scenario) assert.deepEqual(readScenario(JSON.parse(JSON.stringify(res.scenario))), { inputs: mine, advisor: null });
  assert.equal(readScenario(undefined), null);
  assert.equal(readScenario({ v: 3, inputs: mine }), null);
  assert.equal(readScenario({ v: 1, inputs: { ...mine, months: 0 } }), null);
});

/** A full analysis with its plan, as the analyze route makes one (the advisor's ground). */
function analysed(asking = 420_000): { r: Report; plan: RenovationPlan } {
  const { subject, sales } = generateMarketData({ seed: 11, asOf: ASOF });
  const first = evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: asking } });
  const plan = planRenovation({
    subject, currentCondition: subject.condition, arvPoint: first.arv.compBased, ceiling: first.arv.ceiling, config: DEFAULT_MARKET_CONFIG,
    needs: { kitchen: "replace", baths: "refresh", flooring: "replace", paint: "refresh", exterior: "none", landscaping: "refresh", windows: "replace", roof: "none", electrical: "none", plumbing: "none", hvac: "none", basement: "none" },
  });
  const r = evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: asking, rehab: plan.rehab.likely }, resale: { afterPlan: plan.afterPlanValue!, leftBelowPar: plan.leftBelowPar ?? [] } });
  return { r, plan };
}

const advisorSent = (choices: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  choices: Object.entries(choices).map(([key, option]) => ({ key, option })),
  costs: [],
  crewPct: 0,
  resale: { basis: "analysis", value: 0 },
  reviewOpen: false,
  ...extra,
});

test("scenario v2: the analysis' own scope and inputs keep nothing; a changed scope is kept with server numbers", () => {
  const { r, plan } = analysed();
  const base = inputsOf(r);
  const ab = advisorBase(r, plan, base);
  assert.ok(ab.ok);
  if (!ab.ok) return;
  const same = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(ab.base.advised as Record<string, string>) }, { demo: true, now: NOW, plan });
  assert.deepEqual(same, { ok: true, scenario: null });
  const cosmetic = approachChoices(ab.base, "cosmetic") as Record<string, string>;
  // The browser says the estimate is $1: the server works the estimate out itself.
  const res = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(cosmetic, { resale: { basis: "estimate", value: 1 }, crewPct: 0.15 }) }, { demo: true, now: NOW, plan });
  assert.ok(res.ok && res.scenario);
  if (!res.ok || !res.scenario) return;
  assert.equal(res.scenario.v, 2);
  const est = estimateFor(ab.base, approachChoices(ab.base, "cosmetic"));
  assert.ok(Math.abs(res.scenario.advisor!.resale.value - est) < 0.01, "the estimate is the server's");
  assert.ok(Math.abs(res.scenario.snapshot.resale! - est) < 0.01);
  assert.equal(res.scenario.advisor!.crewPct, 0.15);
  // It reads back as the same scope.
  const back = readScenario(JSON.parse(JSON.stringify(res.scenario)));
  assert.ok(back && back.advisor);
  assert.deepEqual(back!.advisor!.choices, cosmetic);
});

test("scenario v2: a resale the person typed is theirs (held to a range); bad scope input is refused", () => {
  const { r, plan } = analysed();
  const base = inputsOf(r);
  const ab = advisorBase(r, plan, base);
  if (!ab.ok) return;
  const mine = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(ab.base.advised as Record<string, string>, { resale: { basis: "mine", value: 777_000 } }) }, { demo: true, now: NOW, plan });
  assert.ok(mine.ok && mine.scenario);
  if (mine.ok && mine.scenario) assert.equal(mine.scenario.snapshot.resale, 777_000);
  for (const bad of [
    advisorSent({ kitchen: "gold" }),
    advisorSent({ attic: "replace" }),
    advisorSent({}, { crewPct: 0.95 }),
    advisorSent({}, { resale: { basis: "estimate", value: 1e12 } }),
    advisorSent({}, { costs: [{ key: "kitchen", action: "replace", cost: -5 }] }),
    advisorSent({}, { extra: 1 }),
    { ...advisorSent({}), __proto__: { polluted: true } },
  ]) {
    const res = scenarioFor(r, { inputs: base.inputs, advisor: bad }, { demo: true, now: NOW, plan });
    assert.equal(res.ok, false, JSON.stringify(bad));
  }
});

test("scenario v2: a cost below the typical range is kept and named in the snapshot; the crew discount stops at 50%", () => {
  const { r, plan } = analysed();
  const base = inputsOf(r);
  const ab = advisorBase(r, plan, base);
  if (!ab.ok) return;
  const advised = ab.base.advised as Record<string, string>;
  const line = plan.items.find((i) => i.key === "kitchen")!;
  const res = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(advised, { costs: [{ key: "kitchen", action: line.action, cost: 0 }] }) }, { demo: true, now: NOW, plan });
  assert.ok(res.ok && res.scenario);
  if (!res.ok || !res.scenario) return;
  assert.deepEqual(res.scenario.snapshot.belowTypical, [{ key: "kitchen", label: line.label, cost: 0, low: line.costLow, high: line.costHigh, typed: true }]);
  assert.ok(Math.abs(res.scenario.snapshot.rehab! - (plan.rehab.likely - line.costLikely)) < 0.01, "the $0 is used");
  // Standard costs: nothing to name.
  const plain = scenarioFor(r, { inputs: { ...base.inputs, purchase: 400_000 }, advisor: advisorSent(advised) }, { demo: true, now: NOW, plan });
  assert.ok(plain.ok && plain.scenario && plain.scenario.snapshot.belowTypical === undefined);
  assert.equal(scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(advised, { crewPct: 0.6 }) }, { demo: true, now: NOW, plan }).ok, false);
  assert.equal(scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(advised, { crewPct: 0.5 }) }, { demo: true, now: NOW, plan }).ok, true);
});

test("scenario v2: a resale typed above the fully renovated value is kept, but its verdict is never a GO, on demo numbers either", () => {
  const { r, plan } = analysed(150_000);
  const base = inputsOf(r);
  const ab = advisorBase(r, plan, base);
  if (!ab.ok) return;
  const advised = ab.base.advised as Record<string, string>;
  const at = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(advised, { resale: { basis: "mine", value: ab.base.fullValue } }) }, { demo: true, now: NOW, plan });
  assert.ok(at.ok && at.scenario && at.scenario.snapshot.verdict === "GO", "at the fully renovated value a demo GO stands");
  const above = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent(advised, { resale: { basis: "mine", value: ab.base.fullValue * 1.5 } }) }, { demo: true, now: NOW, plan });
  assert.ok(above.ok && above.scenario);
  if (above.ok && above.scenario) {
    assert.equal(above.scenario.snapshot.verdict, "CHECK FIRST");
    assert.ok(Math.abs(above.scenario.snapshot.resale! - ab.base.fullValue * 1.5) < 0.01, "the person's value is kept");
  }
});

test("scenario v2: a scope for a deal whose plan was saved before the advisor is refused in words; v1 still works there", () => {
  const { r, plan } = analysed();
  const base = inputsOf(r);
  const { basis: _b, ...old } = plan;
  void _b;
  const res = scenarioFor(r, { inputs: base.inputs, advisor: advisorSent({ kitchen: "skip" }) }, { demo: true, now: NOW, plan: old });
  assert.equal(res.ok, false);
  const v1 = scenarioFor(r, { ...base.inputs, purchase: 400_000 }, { demo: true, now: NOW, plan: old });
  assert.ok(v1.ok && v1.scenario && v1.scenario.v === 1);
  void defaultAdvisor;
});
