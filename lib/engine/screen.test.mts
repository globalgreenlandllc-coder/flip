import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, REAL_SALES_CONFIG, REAL_SALES_TIERS, REPAIR_CONDITION, byPromise, heatOf, screenListing } from "./index.ts";
import type { PropertyFacts, Sale, ScreenResult } from "./index.ts";

const ASOF = "2026-11-10";
const MILE = 1 / 69.0;
const HOME: PropertyFacts = { id: "home", lat: 47.1, lng: -122.3, submarket: "98000", sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null, condition: "dated" };
const daysBefore = (days: number) => new Date(Date.parse(`${ASOF}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
const sale = (n: number, price = 520_000): Sale => ({ id: `s${n}`, address: `${100 + n} Sample St`, lat: HOME.lat + (0.1 + (n % 5) * 0.05) * MILE, lng: HOME.lng, submarket: "98000", sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null, condition: "unknown", price, saleDate: daysBefore(30 + n * 9) });
const TOWN = Array.from({ length: 12 }, (_, i) => sale(i));
const terms = { ...DEFAULT_DEAL_TERMS, targetProfit: 60_000 };
const screen = (askingPrice: number, over: Partial<PropertyFacts> = {}, sales = TOWN) =>
  screenListing({ subject: { ...HOME, ...over }, askingPrice, sales, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS.slice(0, 3), terms });

test("a repair level stands for the full analysis's own rates for a house in that condition", () => {
  assert.deepEqual(REPAIR_CONDITION, { light: "average", medium: "dated", heavy: "distressed" });
  for (const [level, [low, likely, high]] of [["light", [18, 25, 35]], ["medium", [30, 42, 60]], ["heavy", [55, 75, 100]]] as const) {
    const r = screen(250_000, { condition: REPAIR_CONDITION[level] });
    assert.deepEqual(r.rehab, { low: low * 1_800, likely: likely * 1_800, high: high * 1_800 }, level);
  }
});

test("hot is the target reached at the asking price; warm is some profit short of it; cold is none", () => {
  const atTarget = screen(100_000);
  const offer = Math.floor(atTarget.maxOffer!);
  // At the most that can be paid for the target, it is reached; a thousand dollars more, and it is not.
  const hot = screen(offer);
  const warm = screen(offer + 1_000);
  assert.equal(hot.heat, "hot");
  assert.ok(hot.profit! >= 60_000 && hot.profit! < 60_100, `${hot.profit}`);
  assert.equal(warm.heat, "warm");
  assert.ok(warm.profit! > 0 && warm.profit! < 60_000);
  const cold = screen(600_000);
  assert.equal(cold.heat, "cold");
  assert.ok(cold.profit! <= 0);
  // The most that can be paid does not depend on what is asked.
  assert.equal(Math.round(warm.maxOffer!), Math.round(hot.maxOffer!));
  // The worst case is worse than the base.
  assert.ok(hot.worstCaseProfit! < hot.profit!);
});

test("with nothing sold near it a home cannot be valued, and says so instead of guessing", () => {
  const r = screen(250_000, {}, []);
  assert.deepEqual([r.heat, r.arv, r.profit, r.maxOffer, r.worstCaseProfit], ["unknown", null, null, null, null]);
  const far = screen(250_000, { lat: HOME.lat + 5 * MILE });
  assert.equal(far.heat, "unknown");
});

test("the value is what homes like it sold for around it, and says how sure it is", () => {
  const r = screen(250_000);
  assert.ok(r.arv && r.arv.point > 500_000 && r.arv.point < 540_000, `${r.arv?.point}`);
  assert.equal(r.arv!.confidence, "MEDIUM", "never HIGH on sales of unknown condition");
  assert.deepEqual([r.arv!.comps, r.arv!.radiusMiles], [8, 0.5]);
  const few = screen(250_000, {}, TOWN.slice(0, 3));
  assert.deepEqual([few.arv!.confidence, few.arv!.lowBecause], ["LOW", ["few"]]);
});

test("the most promising first: hot, warm, cold, then what could not be valued, and within each the most profit first", () => {
  const home = (heat: ScreenResult["heat"], profit: number | null) => ({ screen: { heat, profit } as ScreenResult, name: `${heat} ${profit}` });
  const sorted = [home("cold", -5), home("unknown", null), home("hot", 70), home("warm", 10), home("hot", 90), home("warm", 40), home("cold", -50)].sort(byPromise);
  assert.deepEqual(sorted.map((h) => h.name), ["hot 90", "hot 70", "warm 40", "warm 10", "cold -5", "cold -50", "unknown null"]);
});

test("hot is the target reached to the dollar: a profit equal to the target is hot, a cent less is warm, nothing is cold", () => {
  assert.equal(heatOf(60_000, 60_000), "hot");
  assert.equal(heatOf(59_999.99, 60_000), "warm");
  assert.equal(heatOf(0.01, 60_000), "warm");
  assert.equal(heatOf(0, 60_000), "cold");
  assert.equal(heatOf(-5, 60_000), "cold");
});

test("asked for, a screen lists the sales its value was drawn from; a whole area's first look does not", () => {
  const listed = screenListing({ subject: HOME, askingPrice: 250_000, sales: TOWN, asOf: ASOF, config: REAL_SALES_CONFIG, tiers: REAL_SALES_TIERS.slice(0, 3), terms, withComps: true });
  assert.equal(listed.comps?.length, listed.arv?.comps);
  assert.ok(listed.comps!.every((c) => c.address && c.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.saleDate) && c.distanceMiles <= 0.5 && c.adjustedPrice > 0));
  assert.equal(screen(250_000).comps, undefined);
});
