import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEAL_TERMS,
  DEFAULT_MARKET_CONFIG,
  REAL_SALES_CONFIG,
  REAL_SALES_TIERS,
  compareToComp,
  countedLotSqft,
  estimateArv,
  evaluate,
  gateReasons,
  neighborhoodCeiling,
  selectComps,
  withGate,
} from "./index.ts";
import type { PropertyFacts, Sale } from "./index.ts";
import { planRenovation } from "./renovation.ts";

/**
 * What the engine does with real sold records, which differ from the demo's
 * made-up ones in four ways: they do not say what condition a house sold in,
 * they leave facts out (a garage's size, sometimes a year), they carry
 * prices that were never a market price, and outside a town they are miles
 * and months apart.
 */

const ASOF = "2026-11-10";
const MILE = 1 / 69.0;
const SUBJECT: PropertyFacts = { id: "subject", lat: 47.1, lng: -122.3, submarket: "98000", sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null, condition: "dated" };

const daysBefore = (days: number) => new Date(Date.parse(`${ASOF}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** A sold home like the subject, as a public record gives it: no condition, no garage size. */
function sold(n: number, over: Partial<Sale> & { miles?: number; daysAgo?: number } = {}): Sale {
  const { miles = 0.2 + (n % 5) * 0.05, daysAgo = 30 + n * 9, ...rest } = over;
  return {
    id: `sale-${n}`,
    address: `${100 + n} Sample St, Fixture Falls, WA 98000`,
    lat: SUBJECT.lat + miles * MILE,
    lng: SUBJECT.lng,
    submarket: "98000",
    sqft: 1_800,
    lotSqft: 7_200,
    beds: 3,
    baths: 2,
    yearBuilt: 1984,
    garage: null,
    condition: "unknown",
    price: 520_000 + (n % 4) * 5_000,
    saleDate: daysBefore(daysAgo),
    ...rest,
  };
}
const town = (count = 12) => Array.from({ length: count }, (_, i) => sold(i));

test("land does not count the same by the foot at every size", () => {
  const counted = (lot: number) => countedLotSqft(lot, DEFAULT_MARKET_CONFIG);
  assert.equal(counted(5_000), 5_000);
  assert.equal(counted(10_000), 10_000);
  assert.equal(counted(43_560), 10_000 + 0.25 * 33_560);
  assert.equal(counted(87_120), 10_000 + 0.25 * 33_560 + 0.05 * 43_560);
  assert.equal(counted(-5), 0);
  // More land is never worth less.
  for (const lot of [1_000, 9_999, 10_001, 40_000, 43_561, 400_000]) assert.ok(counted(lot + 500) > counted(lot));
});

test("a house on an acre keeps its comps on quarter-acre lots", () => {
  // The case that emptied a comp set: at a flat $4 a foot an acre beside 12,000 sqft is a $125,000 adjustment.
  const acre: PropertyFacts = { ...SUBJECT, sqft: 2_000, lotSqft: 43_621 };
  const sales = town().map((s, i) => ({ ...s, sqft: 1_900 + i * 20, lotSqft: 10_000 + i * 300, price: 560_000 + i * 6_000 }));
  const { comps, leftOut } = selectComps(acre, sales, ASOF, REAL_SALES_CONFIG, "renovated", REAL_SALES_TIERS);
  assert.equal(leftOut.overAdjusted, 0);
  assert.ok(comps.length >= 5);
  const lot = comps[0].adjustments.find((a) => a.factor === "lot sqft")!.amount;
  assert.ok(lot > 20_000 && lot < 40_000, `the acre adds $${Math.round(lot)}, not $125,000`);
});

test("what one side does not say is not compared, and is named", () => {
  const price = 500_000;
  const full = compareToComp({ ...SUBJECT, garage: 2 }, "renovated", sold(1, { garage: 1, condition: "average", beds: 2, yearBuilt: 1974 }), price, DEFAULT_MARKET_CONFIG);
  assert.deepEqual(full.notCompared, []);
  assert.deepEqual(Object.fromEntries(full.adjustments.map((a) => [a.factor, Math.round(a.amount)])), { beds: 8_000, garage: 10_000, age: 5_000, condition: 60_000 });

  // The same pair as public records give them: no garage size on one side, no condition, no year.
  const thin = compareToComp({ ...SUBJECT, garage: 2 }, "renovated", sold(1, { garage: null, yearBuilt: null, beds: 2 }), price, DEFAULT_MARKET_CONFIG);
  assert.deepEqual(thin.notCompared, ["garage", "age", "condition"]);
  assert.deepEqual(Object.fromEntries(thin.adjustments.map((a) => [a.factor, a.amount])), { beds: 8_000 });

  const blank = compareToComp({ ...SUBJECT, lotSqft: null, beds: null, baths: null, yearBuilt: null }, "renovated", sold(1), price, DEFAULT_MARKET_CONFIG);
  assert.deepEqual(blank.notCompared, ["lot sqft", "beds", "baths", "garage", "age", "condition"]);
  assert.deepEqual(blank.adjustments, []);
});

test("sales of unknown condition are taken as they sold, and the estimate says so and never claims HIGH confidence", () => {
  const sales = town(12);
  const arv = estimateArv(SUBJECT, sales, ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.equal(arv.conditionKnown, false);
  // No +12% "to renovated" is laid on a house nobody knows the condition of: the value sits among the prices themselves.
  assert.ok(arv.point >= 520_000 && arv.point <= 535_000, `ARV ${arv.point}`);
  assert.ok(arv.comps.every((c) => c.notCompared.includes("condition") && !c.adjustments.some((a) => a.factor === "condition")));
  assert.notEqual(arv.confidence, "HIGH");

  // The same sales, known to have sold in average shape, are adjusted up to renovated and may be HIGH.
  const known = estimateArv(SUBJECT, sales.map((s) => ({ ...s, condition: "average" as const })), ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.equal(known.conditionKnown, true);
  assert.ok(known.point > arv.point * 1.1);

  const report = evaluate({ subject: SUBJECT, sales, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  assert.ok(report.narrative.some((line) => /do not say what condition these homes sold in/.test(line)));
  assert.ok(report.narrative.some((line) => /Older sales are taken at the price they sold for/.test(line)));
});

test("real prices are not moved for time: a sale is taken at what it sold for", () => {
  const sales = town();
  const real = selectComps(SUBJECT, sales, ASOF, REAL_SALES_CONFIG, "renovated", REAL_SALES_TIERS);
  assert.ok(real.comps.every((c) => c.timeAdjustedPrice === c.sale.price));
  const demo = selectComps(SUBJECT, sales, ASOF, DEFAULT_MARKET_CONFIG, "renovated", REAL_SALES_TIERS);
  assert.ok(demo.comps.every((c) => c.timeAdjustedPrice > c.sale.price));
});

test("a price that was never a market price is left out, and the report says how many", () => {
  // A deed for a sixth of the going rate, and one for five times it, among ten ordinary sales.
  const sales = [...town(10), sold(50, { price: 90_000, daysAgo: 40, miles: 0.1 }), sold(51, { price: 2_700_000, daysAgo: 45, miles: 0.1 })];
  const arv = estimateArv(SUBJECT, sales, ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.equal(arv.leftOut.outliers, 2);
  assert.ok(!arv.comps.some((c) => c.sale.id === "sale-50" || c.sale.id === "sale-51"));
  assert.ok(arv.point >= 520_000 && arv.point <= 535_000);
  const report = evaluate({ subject: SUBJECT, sales, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  assert.ok(report.narrative.some((line) => /^2 sales in the search were left out: 2 sold for under a quarter or over four times what a square foot usually goes for among these sales/.test(line)));

  // With too few sales to know what a square foot goes for here, nothing is called odd.
  const few = selectComps(SUBJECT, [sold(1), sold(2), sold(50, { price: 90_000 })], ASOF, REAL_SALES_CONFIG, "renovated", REAL_SALES_TIERS);
  assert.equal(few.leftOut.outliers, 0);
  assert.equal(few.comps.length, 3);
});

test("a street that really sells for half of what the mile around it does, or for three times, keeps its own sales", () => {
  // Six sales on the house's own street around $240,000; forty within a mile around $510,000. The street's sales
  // are the house's comps. Throwing them out as "odd" would value the house at twice what its street fetches.
  const around = Array.from({ length: 40 }, (_, i) => sold(400 + i, { price: 505_000 + (i % 9) * 5_000, miles: 0.55 + (i % 8) * 0.05, daysAgo: 30 + i * 8 }));
  const street = (price: number) => Array.from({ length: 6 }, (_, i) => sold(200 + i, { price: price + i * 4_000, miles: 0.05 + i * 0.02, daysAgo: 30 + i * 12 }));
  const cheap = estimateArv(SUBJECT, [...street(228_000), ...around], ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.equal(cheap.leftOut.outliers, 0);
  assert.ok(cheap.comps.every((c) => c.sale.price < 260_000), `comps: ${cheap.comps.map((c) => c.sale.price).join(", ")}`);
  assert.ok(cheap.point > 220_000 && cheap.point < 260_000, `value ${cheap.point}`);
  // And the mirror: a street of $1.85M homes among $510,000 ones is not valued at $510,000.
  const dear = estimateArv(SUBJECT, [...street(1_850_000), ...around], ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.equal(dear.leftOut.outliers, 0);
  assert.ok(dear.point > 1_800_000, `value ${dear.point}`);
});

test("a cluster of odd deeds next door does not become the norm: what is usual is told by all the sales, not by the nearest handful", () => {
  // Six lots sold by a builder on the house's own street for a fifth of a house's price, four ordinary sales beside
  // them, forty ordinary sales in the mile around. Among the nearest ten the deeds are the majority.
  const deeds = Array.from({ length: 6 }, (_, i) => sold(200 + i, { price: 95_000 + i * 1_000, miles: 0.1 + i * 0.02, daysAgo: 30 + i * 10 }));
  const beside = Array.from({ length: 4 }, (_, i) => sold(300 + i, { price: 520_000 + i * 4_000, miles: 0.3 + i * 0.03, daysAgo: 40 + i * 20 }));
  const around = Array.from({ length: 40 }, (_, i) => sold(400 + i, { price: 505_000 + (i % 9) * 5_000, miles: 0.55 + (i % 8) * 0.05, daysAgo: 30 + i * 8 }));
  const arv = estimateArv(SUBJECT, [...deeds, ...beside, ...around], ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.ok(arv.comps.length >= 5);
  assert.ok(arv.comps.every((c) => c.sale.price > 400_000), `comps: ${arv.comps.map((c) => c.sale.price).join(", ")}`);
  assert.ok(arv.point > 480_000 && arv.point < 560_000, `value ${arv.point}`);
  assert.ok(arv.leftOut.outliers >= 1);
});

test("the house is never its own comp; sales that happen to share an id are still each a sale", () => {
  const { comps } = selectComps(SUBJECT, [...town(6), { ...sold(99), id: SUBJECT.id }], ASOF, REAL_SALES_CONFIG, "renovated", REAL_SALES_TIERS);
  assert.equal(comps.length, 6);
  // A caller of the numbers-only route may send sales with no ids of their own to speak of.
  const sameId = town(7).map((s) => ({ ...s, id: "x" }));
  assert.equal(selectComps(SUBJECT, sameId, ASOF, REAL_SALES_CONFIG, "renovated", REAL_SALES_TIERS).comps.length, 7);
});

test("a ceiling drawn from all the sales read does not cap a house below its own nearest sales, and is said as what it is", () => {
  // Five sales on the street at $600,000 and up, some months back; sixty more recent ones in the zip code around $470,000.
  const street = Array.from({ length: 5 }, (_, i) => sold(500 + i, { price: 600_000 + i * 2_000, miles: 0.05 + i * 0.02, daysAgo: 150 + i * 8 }));
  const zip = Array.from({ length: 60 }, (_, i) => sold(600 + i, { price: 455_000 + (i % 7) * 5_000, miles: 0.6 + (i % 8) * 0.05, daysAgo: 20 + i * 2 }));
  const run = (sales: Sale[]) => evaluate({ subject: SUBJECT, sales, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  const report = run([...street, ...zip]);
  const { arv } = report;
  assert.ok(arv.point >= 600_000 && arv.point <= 608_000, `value ${arv.point}`);
  assert.deepEqual([arv.cappedByCeiling, arv.ceiling], [false, null]);
  assert.ok(arv.ceilingSetAside && arv.ceilingSetAside.basis === "all" && arv.ceilingSetAside.value < 520_000);
  // The report says the ceiling is not known, and why. It does not say the block "has never cleared" a figure five sales cleared.
  const flag = report.riskFlags.find((f) => f.code === "NO_CEILING");
  // Nor that the zip code said anything: only the sold homes that were read around the house did.
  assert.match(flag!.message, /^The sold homes compared here went for more than the dearest tenth of the sold homes of this size found around this house in 98000 \(\$\d+\/sqft, n=\d+\), so those do not say where this block tops out\. Ceiling unknown/);
  assert.ok(!report.riskFlags.some((f) => f.code === "CEILING_BINDS"));
  const said = (r: typeof report) => [...r.narrative, ...r.riskFlags.map((f) => f.message)];
  assert.ok(!said(report).some((line) => /never cleared|the zip code does not|sales in this zip code in 12 months/.test(line)));

  // Where the house's comps sit under that top, the ceiling stands and guides the plan. It is worded as a guide:
  // nothing is capped by it, and the line does not say "caps out".
  const under = run(zip);
  assert.ok(under.arv.ceiling && under.arv.ceiling.basis === "all" && under.arv.point <= under.arv.ceiling.value);
  assert.equal(under.arv.ceilingSetAside, undefined);
  const line = under.narrative.find((l) => l.startsWith("Neighborhood ceiling:"));
  assert.match(line ?? "", /^Neighborhood ceiling: the dearest tenth of the sold homes of this size found around this house in 98000, whatever their condition, cleared \$\d+\/sqft \(n=60\), so a home of this size has topped out near \$[\d,]+ \(a guide, not a cap\)\.$/);
  assert.ok(!said(under).some((l) => /caps out/.test(l)));

  // Too few of them in the house's zip code: said of the sold homes that were read, not of the zip code.
  const elsewhere = run(zip.map((s, i) => (i < 6 ? s : { ...s, submarket: "98001" })));
  assert.match(elsewhere.riskFlags.find((f) => f.code === "NO_CEILING")!.message, /^Too few of the sold homes found around this house are in its zip code and from the last 12 months to say where the market tops out\./);

  // Sales known to be renovated still cap the value, as they always did.
  const renovated = Array.from({ length: 8 }, (_, i) => sold(700 + i, { condition: "renovated", price: 600_000, sqft: 1_800, beds: 2, baths: 1, yearBuilt: 1950, garage: 0, miles: 0.1 + i * 0.01, daysAgo: 30 + i * 10 }));
  const capped = run(renovated).arv;
  assert.deepEqual([capped.cappedByCeiling, capped.ceiling?.basis], [true, "renovated"]);
});

test("a house whose bathrooms nobody gave is priced as having two, and the plan's line says so", () => {
  const needs = { kitchen: "none", baths: "refresh", flooring: "none", paint: "none", exterior: "none", landscaping: "none", windows: "none", roof: "none", electrical: "none", plumbing: "none", hvac: "none", basement: "none" } as const;
  const plan = (baths: number | null) => planRenovation({ subject: { ...SUBJECT, baths }, currentCondition: "dated", needs, arvPoint: 520_000, ceiling: null, config: REAL_SALES_CONFIG });
  const line = (baths: number | null) => plan(baths).items.find((i) => i.key === "baths")!;
  assert.deepEqual([line(null).costLow, line(null).costHigh], [line(2).costLow, line(2).costHigh]);
  assert.ok(line(null).costLikely > line(1).costLikely, "one bathroom is the least a house can have, and the least flatters the deal");
  assert.match(line(null).reason, /The number of bathrooms is not known: priced as 2\.$/);
  assert.doesNotMatch(line(2).reason, /not known/);
  assert.equal(plan(null).rehab.likely, plan(2).rehab.likely);
});

test("the ceiling from sales of unknown condition: the dearest tenth of all of them, from ten or more, odd prices left out", () => {
  const sales = Array.from({ length: 20 }, (_, i) => sold(i, { price: 450_000 + i * 10_000, daysAgo: 30 + i * 10 }));
  const ceiling = neighborhoodCeiling(SUBJECT, sales, ASOF, REAL_SALES_CONFIG);
  assert.ok(ceiling);
  assert.deepEqual([ceiling.basis, ceiling.sampleSize], ["all", 20]);
  assert.ok(ceiling.value >= 600_000 && ceiling.value <= 640_000, `ceiling ${ceiling.value}`);

  // One deed for five times the going rate must not become the ceiling.
  const withOdd = neighborhoodCeiling(SUBJECT, [...sales, sold(77, { price: 2_700_000, daysAgo: 20 })], ASOF, REAL_SALES_CONFIG);
  assert.deepEqual([withOdd?.sampleSize, withOdd?.value], [20, ceiling.value]);

  // Nine sales are not enough to speak of a top tenth; another zip code's sales are not this one's.
  assert.equal(neighborhoodCeiling(SUBJECT, sales.slice(0, 9), ASOF, REAL_SALES_CONFIG), null);
  assert.equal(neighborhoodCeiling(SUBJECT, sales.map((s) => ({ ...s, submarket: "98001" })), ASOF, REAL_SALES_CONFIG), null);
  // Sales older than a year do not count toward it.
  assert.equal(neighborhoodCeiling(SUBJECT, sales.map((s) => ({ ...s, saleDate: daysBefore(400) })), ASOF, REAL_SALES_CONFIG), null);

  // Where sales are known to be renovated, they are the ceiling's own evidence and five are enough.
  const renovated = Array.from({ length: 5 }, (_, i) => sold(i, { condition: "renovated", price: 600_000 + i * 10_000 }));
  assert.deepEqual([neighborhoodCeiling(SUBJECT, [...renovated, ...sales], ASOF, REAL_SALES_CONFIG)?.basis, neighborhoodCeiling(SUBJECT, renovated, ASOF, REAL_SALES_CONFIG)?.sampleSize], ["renovated", 5]);
});

test("in the country the search goes out to five miles and two years, and says the answer is low-confidence", () => {
  const rural = Array.from({ length: 7 }, (_, i) => sold(i, { miles: 3 + i * 0.25, daysAgo: 420 + i * 30 }));
  const demoTiers = estimateArv(SUBJECT, rural, ASOF, REAL_SALES_CONFIG);
  assert.ok(Number.isNaN(demoTiers.point), "the demo's four tiers stop at 2.5 miles and 18 months");
  const arv = estimateArv(SUBJECT, rural, ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.deepEqual([arv.comps.length, arv.criteriaUsed.radiusMiles, arv.criteriaUsed.months, arv.confidence], [7, 5, 24, "LOW"]);
  // Out here a sale four miles off is still a comp among its like: it is not weighed down to nothing against one at three.
  const weights = arv.comps.map((c) => c.weight);
  assert.ok(Math.max(...weights) / Math.min(...weights) < 50, `weights ${weights.map((w) => w.toExponential(1)).join(", ")}`);

  const none = evaluate({ subject: SUBJECT, sales: [], asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  assert.match(none.riskFlags.find((f) => f.code === "NO_COMPS")!.message, /within 5 miles \/ 24 months/);
});

test("a newest sale months old is said out loud, and a house of unknown age gets the age warnings as a question", () => {
  const stale = town(8).map((s, i) => ({ ...s, saleDate: daysBefore(200 + i * 10) }));
  const report = evaluate({ subject: { ...SUBJECT, yearBuilt: null }, sales: stale, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  const codes = report.riskFlags.map((f) => f.code);
  assert.ok(codes.includes("STALE_SALES"));
  assert.match(report.riskFlags.find((f) => f.code === "STALE_SALES")!.message, /The newest comparable sale is from April 2026/);
  assert.ok(codes.includes("YEAR_UNKNOWN") && !codes.includes("PRE_1978") && !codes.includes("OLD_SYSTEMS"));

  const fresh = evaluate({ subject: { ...SUBJECT, yearBuilt: 1955 }, sales: town(8), asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  const freshCodes = fresh.riskFlags.map((f) => f.code);
  assert.ok(!freshCodes.includes("STALE_SALES") && !freshCodes.includes("YEAR_UNKNOWN"));
  assert.ok(freshCodes.includes("PRE_1978") && freshCodes.includes("OLD_SYSTEMS"));
});

test("a GO is withheld in an area that has not passed the accuracy test, and the numbers are left as they are", () => {
  const run = (askingPrice: number, sales = town(12)) => evaluate({ subject: SUBJECT, sales, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice } });
  const go = run(250_000);
  assert.equal(go.deal.verdict, "GO");

  const gated = withGate(go, { areaTested: false });
  assert.equal(gated.deal.verdict, "CHECK FIRST");
  assert.deepEqual(gated.deal.withheld?.map((r) => r.code), ["AREA_UNTESTED"]);
  assert.match(gated.deal.decidingFactor, /^The numbers work at this price: asking is \$[\d,]+ under the max offer.*It is not a GO yet: Renoflip's resale estimate has not been tested against real completed flips in this area yet\.$/);
  assert.match(gated.narrative[0], /^VERDICT: CHECK FIRST\. The numbers work/);
  assert.deepEqual(gated.narrative.slice(1), go.narrative.slice(1));
  // Nothing but the verdict and its sentence changed.
  assert.deepEqual({ ...gated.deal, verdict: "", decidingFactor: "", withheld: undefined }, { ...go.deal, verdict: "", decidingFactor: "", withheld: undefined });
  assert.equal(go.deal.verdict, "GO", "the report handed in is not changed");

  // TIGHT and PASS already say not to offer at this price: they stand.
  const pass = run(900_000);
  assert.equal(pass.deal.verdict, "PASS");
  assert.equal(withGate(pass, { areaTested: false }), pass);

  // A thin, far-apart comp set is a second reason; in a tested area it is the only one.
  const thin = run(150_000, Array.from({ length: 5 }, (_, i) => sold(i, { miles: 3 + i * 0.3, daysAgo: 500 })));
  assert.deepEqual([thin.arv.confidence, thin.deal.verdict], ["LOW", "GO"]);
  assert.deepEqual(gateReasons(thin, { areaTested: false }).map((r) => r.code), ["AREA_UNTESTED", "LOW_CONFIDENCE"]);
  assert.deepEqual(withGate(thin, { areaTested: true }).deal.withheld?.map((r) => r.code), ["LOW_CONFIDENCE"]);
  assert.match(withGate(thin, { areaTested: false }).deal.decidingFactor, /in this area yet; and the resale value is low-confidence: comparable sales had to be looked for as far as 5 miles away and 24 months back\.$/);

  // A tested area with a sound comp set: the GO is given.
  assert.notEqual(go.arv.confidence, "LOW");
  assert.equal(withGate(go, { areaTested: true }), go);
});

test("the reason given for low confidence is the one that holds", () => {
  const run = (sales: Sale[]) => evaluate({ subject: SUBJECT, sales, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 150_000 } });
  const why = (sales: Sale[]) => gateReasons(run(sales), { areaTested: true }).map((r) => r.message);

  // Eight sales within a quarter of a mile, a month or two old, at prices far apart: not few, and not far.
  const apart = Array.from({ length: 8 }, (_, i) => sold(i, { miles: 0.05 + i * 0.02, daysAgo: 20 + i * 5, price: i % 2 ? 620_000 : 430_000 }));
  assert.deepEqual([run(apart).arv.comps.length, run(apart).arv.confidence, run(apart).arv.lowBecause], [8, "LOW", ["apart"]]);
  assert.match(why(apart)[0], /^The resale value is low-confidence: the comparable sales' adjusted prices lie \d\d% apart\.$/);
  assert.doesNotMatch(why(apart)[0], /only|looked for|few/);

  // Three close and alike: few, and nothing else.
  assert.deepEqual(why(town(3)), ["The resale value is low-confidence: there are only 3 comparable sales."]);
  assert.deepEqual(why(town(1)), ["The resale value is low-confidence: there is only one comparable sale."]);
  // Two far out and long ago: both reasons, each said.
  const farAndFew = [sold(1, { miles: 4, daysAgo: 600 }), sold(2, { miles: 4.5, daysAgo: 650 })];
  assert.deepEqual(why(farAndFew), ["The resale value is low-confidence: there are only 2 comparable sales, and comparable sales had to be looked for as far as 5 miles away and 24 months back."]);
  // A sound comp set gives no reason, because it is not low.
  assert.deepEqual([run(town(12)).arv.lowBecause, why(town(12))], [[], []]);
});

test("the sale of a lot in the year its house was built is not a sold home", () => {
  // Thirty homes around at about $520,000, and six new houses on the house's own street whose record still shows
  // the builder's purchase of the lot, this year, for $150,000.
  const around = Array.from({ length: 30 }, (_, i) => sold(i, { miles: 0.5 + (i % 5) * 0.1, daysAgo: 30 + i * 9 }));
  const lots = Array.from({ length: 6 }, (_, i) => sold(900 + i, { miles: 0.02 + i * 0.01, daysAgo: 60 + i * 20, yearBuilt: 2026, price: 150_000 }));
  const report = evaluate({ subject: SUBJECT, sales: [...around, ...lots], asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 300_000 } });
  assert.ok(report.arv.point > 500_000 && report.arv.point < 545_000, `value ${report.arv.point}`);
  assert.ok(report.arv.comps.every((c) => c.sale.price > 400_000));
  assert.ok(report.arv.leftOut.lotSales > 0);
  assert.ok(report.narrative.some((l) => /left out: 6 sold in the year they were built for under half of what a square foot usually goes for among these sales \(as a rule the sale of the lot, before a house stood on it\)/.test(l)), report.narrative.join("\n"));

  // A new house that sold as a house in the year it was built is a comp like any other (for a house of its own age).
  const newHomes = Array.from({ length: 6 }, (_, i) => sold(900 + i, { miles: 0.02 + i * 0.01, daysAgo: 60 + i * 20, yearBuilt: 2026, price: 560_000 }));
  const withNew = estimateArv({ ...SUBJECT, yearBuilt: 2024 }, [...around, ...newHomes], ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS });
  assert.equal(withNew.leftOut.lotSales, 0);
  assert.ok(withNew.comps.some((c) => c.sale.yearBuilt === 2026), `comps built ${withNew.comps.map((c) => c.sale.yearBuilt).join(", ")}`);
  // A cheap sale of an old house is not a lot's: it stays, as a street that is simply cheap must.
  const cheap = Array.from({ length: 6 }, (_, i) => sold(900 + i, { miles: 0.02 + i * 0.01, daysAgo: 60 + i * 20, price: 200_000 }));
  assert.equal(estimateArv(SUBJECT, [...around, ...cheap], ASOF, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS }).leftOut.lotSales, 0);
  // The demo's made-up sales are all of finished houses: the rule is not applied to them.
  assert.equal(DEFAULT_MARKET_CONFIG.lotSaleBelow, null);
  // (And without the rule the six lots would be this house's nearest comps: the value would be a third of what it is.)
  const without = estimateArv(SUBJECT, [...around, ...lots], ASOF, { ...REAL_SALES_CONFIG, lotSaleBelow: null }, { tiers: REAL_SALES_TIERS });
  assert.equal(without.leftOut.lotSales, 0);
  assert.ok(without.point < 300_000, `value without the rule ${without.point}`);
});
