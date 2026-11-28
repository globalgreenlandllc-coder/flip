import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, costsAt, evaluate, withGate } from "./index.ts";
import { generateMarketData } from "./synthetic.ts";
import { planRenovation } from "./renovation.ts";
import { STUDIO_BOUNDS, clampInputs, dealInputs, liveNumbers, liveReport, sameInputs, studioBase, type StudioInputs } from "./studio.ts";
import type { Report } from "./types.ts";

const ASOF = "2026-09-01";

/** A demo analysis as the analyze route works it: a plan, and the deal on what the plan reaches. */
function demoReport(asking = 420_000): Report {
  const { subject, sales } = generateMarketData({ seed: 11, asOf: ASOF });
  const first = evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: asking } });
  const plan = planRenovation({
    subject,
    currentCondition: subject.condition,
    needs: { kitchen: "replace", baths: "refresh", flooring: "replace", paint: "refresh", exterior: "none", landscaping: "refresh", windows: "none", roof: "none", electrical: "none", plumbing: "none", hvac: "none", basement: "none" },
    arvPoint: first.arv.compBased,
    ceiling: first.arv.ceiling,
    config: DEFAULT_MARKET_CONFIG,
  });
  return evaluate({
    subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG,
    deal: { ...DEFAULT_DEAL_TERMS, askingPrice: asking, rehab: plan.rehab.likely },
    resale: plan.afterPlanValue === undefined ? undefined : { afterPlan: plan.afterPlanValue, leftBelowPar: plan.leftBelowPar ?? [] },
  });
}

/** Quick numbers' shape: typed months, rate and target, the fully renovated value. */
function quickReport(): Report {
  const { subject, sales } = generateMarketData({ seed: 5, asOf: ASOF });
  return evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, holdingMonths: 9, targetProfit: 45_000, financing: { rate: 0.095, ltc: 0.8, points: 0.015 }, askingPrice: 600_000, rehab: 80_000 } });
}

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

test("studio: an analysis carries the terms it was worked out with, and they give back its own numbers", () => {
  for (const report of [demoReport(), quickReport()]) {
    assert.ok(report.deal.terms, "the deal keeps its terms");
    const base = studioBase(report);
    assert.equal(base.editable, true);
    if (!base.editable) return;
    assert.equal(base.inputs.purchase, report.deal.purchasePrice);
    assert.equal(base.resale, report.deal.arv, "the resale the Studio works on is the deal's own (after the plan, or fully renovated)");
    const live = liveNumbers(base.rehab, base.resale, base.inputs);
    assert.ok(near(live.deal.profit, report.deal.profit), `profit ${live.deal.profit} vs ${report.deal.profit}`);
    assert.ok(near(live.deal.maxAllowableOffer, report.deal.maxAllowableOffer));
    assert.ok(near(live.deal.worstCaseProfit, report.deal.worstCaseProfit));
    assert.equal(live.deal.verdict, report.deal.verdict);
  }
});

test("studio: Quick numbers' typed months, rate and target are what the Studio opens on", () => {
  const base = studioBase(quickReport());
  assert.ok(base.editable);
  if (!base.editable) return;
  assert.equal(base.inputs.months, 9);
  assert.equal(base.inputs.targetProfit, 45_000);
  assert.equal(base.inputs.rate, 0.095);
  assert.equal(base.inputs.ltc, 0.8);
  assert.equal(base.inputs.points, 0.015);
  assert.equal(base.rehab, 80_000);
});

test("studio: at the maximum offer the profit is the target, to the cent", () => {
  const report = demoReport();
  const base = studioBase(report);
  assert.ok(base.editable);
  if (!base.editable) return;
  for (const target of [20_000, 60_000, 95_000]) {
    const at = { ...base.inputs, targetProfit: target };
    const mao = liveNumbers(base.rehab, base.resale, at).deal.maxAllowableOffer;
    const there = liveNumbers(base.rehab, base.resale, { ...at, purchase: mao });
    assert.ok(near(there.deal.profit, target, 1e-6), `profit ${there.deal.profit} at the max offer for ${target}`);
  }
});

test("studio: the margin (profit ÷ resale) and the return on cost (profit ÷ total cost) are different figures", () => {
  const base = studioBase(demoReport());
  assert.ok(base.editable);
  if (!base.editable) return;
  const live = liveNumbers(base.rehab, base.resale, base.inputs);
  assert.ok(live.margin !== null && live.roiOnCost !== null);
  assert.ok(near(live.margin!, live.deal.profit / base.resale));
  assert.ok(near(live.roiOnCost!, live.deal.profit / live.deal.totalCost));
  assert.notEqual(live.margin!.toFixed(4), live.roiOnCost!.toFixed(4));
});

test("studio: the price, the months, the target and every assumption leave the resale value where it is", () => {
  const base = studioBase(demoReport());
  assert.ok(base.editable);
  if (!base.editable) return;
  const changes: Partial<StudioInputs>[] = [{ purchase: 100_000 }, { purchase: 900_000 }, { months: 1 }, { months: 24 }, { targetProfit: 0 }, { rate: 0.2 }, { ltc: 0 }, { points: 0.05 }, { monthlyHolding: 5_000 }, { closingBuyPct: 0.05 }, { closingSellPct: 0.1 }, { reserve: 0.5 }];
  for (const c of changes) {
    const live = liveNumbers(base.rehab, base.resale, { ...base.inputs, ...c });
    assert.equal(live.deal.arv, base.resale, JSON.stringify(c));
  }
});

test("studio: one more month is the same deal with the months one higher (holding and interest follow)", () => {
  const base = studioBase(demoReport());
  assert.ok(base.editable);
  if (!base.editable) return;
  const live = liveNumbers(base.rehab, base.resale, base.inputs);
  const d = dealInputs(base.rehab, { ...base.inputs, months: base.inputs.months + 1 });
  assert.ok(near(live.oneMoreMonth.profit, costsAt(base.inputs.purchase, base.resale, live.deal.rehabWithReserve, d).profit));
  assert.ok(near(live.oneMoreMonth.cost, live.deal.profit - live.oneMoreMonth.profit));
  assert.ok(live.oneMoreMonth.cost > 0, "a month costs money");
  assert.ok(near(live.downsideWithMonth, costsAt(base.inputs.purchase, base.resale * 0.9, live.deal.rehabWithReserve * 1.2, d).profit));
  assert.ok(live.downsideWithMonth < live.deal.worstCaseProfit);
});

test("studio: the cash needed is every cost before the sale less the loan, and the return on cash is profit over it", () => {
  const base = studioBase(demoReport());
  assert.ok(base.editable);
  if (!base.editable) return;
  const live = liveNumbers(base.rehab, base.resale, base.inputs);
  const loan = base.inputs.ltc * (base.inputs.purchase + live.deal.rehabWithReserve);
  assert.ok(near(live.cashNeeded, live.deal.totalCost - live.deal.closingSell - loan));
  assert.ok(near(live.roiOnCash!, live.deal.profit / live.cashNeeded));
});

test("studio: on real sold prices a live deal is never a GO — CHECK FIRST with the gate's reasons; a demo keeps its verdict", () => {
  const report = demoReport();
  const base = studioBase(report);
  assert.ok(base.editable);
  if (!base.editable) return;
  // Bought cheaply the numbers alone say GO.
  const cheap = liveNumbers(base.rehab, base.resale, { ...base.inputs, purchase: 150_000 });
  assert.equal(cheap.deal.verdict, "GO");
  const real = liveReport(report, cheap.deal, { demo: false });
  assert.equal(real.deal.verdict, "CHECK FIRST");
  assert.ok(real.deal.withheld?.some((r) => r.code === "AREA_UNTESTED"));
  assert.equal(real.deal.profit, cheap.deal.profit, "the gate changes the word, not the numbers");
  const demo = liveReport(report, cheap.deal, { demo: true });
  assert.equal(demo.deal.verdict, "GO");
  // What the resale is stays said.
  assert.equal(real.deal.resaleBasis, report.deal.resaleBasis);
  assert.equal(real.deal.fullyRenovated, report.deal.fullyRenovated);
});

test("studio: at the analysis' own inputs the live gated verdict is the server's gated verdict", () => {
  const raw = demoReport(150_000);
  const served = withGate(raw, { areaTested: false });
  const base = studioBase(served);
  assert.ok(base.editable);
  if (!base.editable) return;
  const shown = liveReport(served, liveNumbers(base.rehab, base.resale, base.inputs).deal, { demo: false });
  assert.equal(shown.deal.verdict, served.deal.verdict);
  assert.equal(shown.deal.decidingFactor, served.deal.decidingFactor);
});

test("studio: a deal saved before the terms were kept opens read-only; so does one whose numbers do not come back", () => {
  const report = demoReport();
  const { terms: _t, ...old } = report.deal;
  void _t;
  assert.deepEqual(studioBase({ ...report, deal: old }), { editable: false, why: "saved-before" });
  const tampered = { ...report, deal: { ...report.deal, terms: { ...report.deal.terms!, holdingMonths: report.deal.terms!.holdingMonths + 3 } } };
  assert.deepEqual(studioBase(tampered), { editable: false, why: "numbers-differ" });
});

test("studio: inputs are held inside their bounds, months whole; two equal sets are the same", () => {
  const base = studioBase(demoReport());
  assert.ok(base.editable);
  if (!base.editable) return;
  const wild = clampInputs({ ...base.inputs, purchase: -5, months: 99.6, rate: 3, ltc: -1, points: Number.NaN });
  assert.equal(wild.purchase, 0);
  assert.equal(wild.months, STUDIO_BOUNDS.months.max);
  assert.equal(wild.rate, STUDIO_BOUNDS.rate.max);
  assert.equal(wild.ltc, 0);
  assert.equal(wild.points, 0);
  assert.equal(clampInputs({ ...base.inputs, months: 5.4 }).months, 5);
  assert.ok(sameInputs(base.inputs, { ...base.inputs }));
  assert.ok(!sameInputs(base.inputs, { ...base.inputs, purchase: base.inputs.purchase + 1 }));
  assert.ok(!sameInputs(base.inputs, { ...base.inputs, rate: base.inputs.rate + 0.001 }));
});

test("studio: the deciding sentence calls the price 'Asking' only at the asking price, 'Your price' once it is changed", () => {
  const report = demoReport();
  const base = studioBase(report);
  assert.ok(base.editable);
  if (!base.editable) return;
  const asking = report.deal.purchasePrice;
  // At the analysed price: the asking price, as the server said it.
  const same = liveNumbers(base.rehab, base.resale, base.inputs, asking);
  assert.equal(same.deal.decidingFactor, report.deal.decidingFactor);
  // A GO at a lower price (demo): "Your price is … under your max offer".
  const cheap = liveNumbers(base.rehab, base.resale, { ...base.inputs, purchase: 150_000 }, asking);
  assert.match(cheap.deal.decidingFactor, /^Your price is \$[\d,]+ under your max offer/);
  // A PASS at a far higher price: "Your price is … ABOVE your max offer".
  const dear = liveNumbers(base.rehab, base.resale, { ...base.inputs, purchase: 2_000_000 }, asking);
  assert.equal(dear.deal.verdict, "PASS");
  assert.match(dear.deal.decidingFactor, /^Your price is \$[\d,]+ ABOVE your max offer/);
  // Gated on real sold prices: "your price is … under the max offer … It is not a GO yet".
  const real = liveReport(report, cheap.deal, { demo: false });
  assert.match(real.deal.decidingFactor, /^The numbers work at this price: your price is \$[\d,]+ under the max offer/);
  const realAtAsking = liveReport(withGate(demoReport(150_000), { areaTested: false }), liveNumbers(base.rehab, base.resale, { ...base.inputs, purchase: 150_000 }, 150_000).deal, { demo: false });
  assert.match(realAtAsking.deal.decidingFactor, /^The numbers work at this price: asking is \$/);
});

test("studio: a payload without a report or a deal opens read-only instead of failing", () => {
  assert.deepEqual(studioBase(undefined), { editable: false, why: "no-deal" });
  assert.deepEqual(studioBase(null), { editable: false, why: "no-deal" });
  assert.deepEqual(studioBase({} as unknown as Report), { editable: false, why: "no-deal" });
});
