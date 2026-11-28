import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate, withGate } from "../engine/index.ts";
import { generateMarketData } from "../engine/synthetic.ts";
import { liveNumbers, studioBase } from "../engine/studio.ts";
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
  if (res.ok && res.scenario) assert.deepEqual(readScenario(JSON.parse(JSON.stringify(res.scenario))), mine);
  assert.equal(readScenario(undefined), null);
  assert.equal(readScenario({ v: 2, inputs: mine }), null);
  assert.equal(readScenario({ v: 1, inputs: { ...mine, months: 0 } }), null);
});
