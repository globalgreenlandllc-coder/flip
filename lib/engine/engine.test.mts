import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEAL_TERMS,
  DEFAULT_MARKET_CONFIG,
  costsAt,
  estimateArv,
  evaluate,
  maxAllowableOffer,
  neighborhoodCeiling,
  selectComps,
  weightedMedian,
  weightedPercentile,
} from "./index.ts";
import { generateMarketData } from "./synthetic.ts";
import type { PropertyFacts, Sale } from "./index.ts";

const ASOF = "2026-09-01";

test("weighted median ignores a single heavy outlier when weights are small", () => {
  const items = [
    { value: 100, weight: 1 },
    { value: 102, weight: 1 },
    { value: 104, weight: 1 },
    { value: 500, weight: 0.05 },
  ];
  assert.equal(weightedMedian(items), 102);
  assert.equal(weightedPercentile(items, 0.9), 104);
});

test("comps: gross adjustment screen drops offsetting adjustments", () => {
  const { subject, sales } = generateMarketData({ seed: 7 });
  const { comps } = selectComps(subject, sales, ASOF, DEFAULT_MARKET_CONFIG);
  assert.ok(comps.length >= DEFAULT_MARKET_CONFIG.minComps, `got ${comps.length} comps`);
  for (const c of comps) {
    assert.ok(c.grossAdjustmentPct <= DEFAULT_MARKET_CONFIG.grossAdjustmentCap);
    assert.ok(c.monthsAgo >= 0);
  }
  // Highest weight first.
  for (let i = 1; i < comps.length; i++) assert.ok(comps[i - 1].weight >= comps[i].weight);
});

test("comps: relaxation widens the search when the tight tier is empty", () => {
  const { subject, sales } = generateMarketData({ seed: 7, count: 60 });
  const { criteriaUsed, comps } = selectComps(subject, sales, ASOF, DEFAULT_MARKET_CONFIG);
  assert.ok(criteriaUsed.radiusMiles >= 0.5);
  assert.ok(comps.length > 0);
});

test("ARV recovers the synthetic truth within 8%", () => {
  const { subject, sales, truth } = generateMarketData({ seed: 42, count: 600 });
  const arv = estimateArv(subject, sales, ASOF, DEFAULT_MARKET_CONFIG);
  const expectedRenovated =
    truth.basePpsf[subject.submarket] * subject.sqft * 1.12 +
    (subject.beds - 3) * 8_000 +
    (subject.baths - 2) * 12_000 +
    subject.garage * 10_000 +
    (subject.yearBuilt - 1970) * 500 +
    (subject.lotSqft - 5000) * 4;
  const err = Math.abs(arv.point - expectedRenovated) / expectedRenovated;
  assert.ok(err < 0.08, `ARV ${arv.point} vs truth ${expectedRenovated} (err ${(err * 100).toFixed(1)}%)`);
  assert.ok(arv.low <= arv.point && arv.point <= arv.high);
});

test("ceiling does not bind when comps sit below it", () => {
  const { subject, sales } = generateMarketData({ seed: 42, count: 600 });
  const arv = estimateArv(subject, sales, ASOF, DEFAULT_MARKET_CONFIG);
  assert.ok(arv.ceiling, "expected a ceiling");
  assert.equal(arv.cappedByCeiling, false);
  assert.equal(arv.point, arv.compBased);
});

test("ceiling caps the comp-based ARV and flags it", () => {
  // Eight identical renovated comps at $600k. The subject is the same size
  // but has an extra bed, an extra bath, two garage spaces and is 40 years
  // newer, so every comp adjusts UP past what the block has ever cleared.
  const base: Omit<Sale, "id" | "saleDate"> = {
    lat: 47.68, lng: -122.36, submarket: "X", sqft: 1800, lotSqft: 5000,
    beds: 3, baths: 2, yearBuilt: 1950, garage: 0, condition: "renovated", price: 600_000,
  };
  const sales: Sale[] = Array.from({ length: 8 }, (_, i) => ({
    ...base,
    id: `c${i}`,
    lat: base.lat + i * 0.0005,
    saleDate: `2026-0${(i % 6) + 3}-15`,
  }));
  const subject: PropertyFacts = { ...base, id: "s", beds: 4, baths: 3, garage: 2, yearBuilt: 1990 };
  const arv = estimateArv(subject, sales, ASOF, DEFAULT_MARKET_CONFIG);
  assert.ok(arv.ceiling, "expected a ceiling");
  assert.ok(arv.compBased > arv.ceiling!.value, `compBased ${arv.compBased} should exceed ceiling ${arv.ceiling!.value}`);
  assert.equal(arv.cappedByCeiling, true);
  assert.equal(arv.point, arv.ceiling!.value);
  assert.ok(arv.high <= arv.ceiling!.value);
  assert.ok(arv.low <= arv.point);
});

test("ceiling returns null when the submarket sample is too thin", () => {
  const { subject, sales } = generateMarketData({ seed: 1, count: 12 });
  const c = neighborhoodCeiling(subject, sales, ASOF, DEFAULT_MARKET_CONFIG);
  assert.equal(c, null);
});

test("MAO closed form: buying at MAO yields exactly the target profit", () => {
  const arv = 620_000;
  const rehab = 80_000;
  const d = { ...DEFAULT_DEAL_TERMS, askingPrice: 0, rehab };
  const mao = maxAllowableOffer(arv, rehab, d);
  const c = costsAt(mao, arv, rehab, d);
  assert.ok(Math.abs(c.profit - d.targetProfit) < 1e-6, `profit ${c.profit}`);
});

test("evaluate: end-to-end verdicts move with asking price", () => {
  const { subject, sales } = generateMarketData({ seed: 42, count: 600 });
  const run = (askingPrice: number) =>
    evaluate({ subject, sales, asOf: ASOF, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice } });
  const mao = run(1).deal.maxAllowableOffer;
  assert.equal(run(mao * 0.85).deal.verdict, "GO");
  assert.equal(run(mao * 1.3).deal.verdict, "PASS");
  const tight = run(mao * 1.06).deal.verdict;
  assert.ok(tight === "TIGHT" || tight === "PASS");
  const report = run(mao * 0.85);
  assert.equal(report.deal.sensitivity.length, 9);
  assert.ok(report.narrative[0].startsWith("VERDICT: GO"));
  assert.ok(report.riskFlags.some((f) => f.code === "PRE_1978"));
});
