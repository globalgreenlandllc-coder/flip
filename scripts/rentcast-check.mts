/**
 * Check RentCast against real houses: what its record says of each, how many
 * sold homes it finds around it, how fresh they are, and what the engine
 * makes of them. This is the "20-house check" of the plan, and the way to
 * see the real service answer before trusting it with the live site.
 *
 *   RENTCAST_API_KEY=… npm run rentcast:check -- "13013 224th St E, Graham, WA 98338" "…"
 *   RENTCAST_API_KEY=… npm run rentcast:check -- --point 47.6615,-122.3340 --sqft 1800
 *
 * It SPENDS REAL REQUESTS: one for a house's record and one to four for the
 * sold homes around it; one for a --point search. --max (default 4) is the
 * most one run may send; past it the remaining houses are not asked about.
 *
 * THE LIVE SITE DOES NOT SEE THESE. The site keeps its own count of what it
 * asks (FLIP_RENTCAST_REQUESTS, 40 of the free plan's 50 by default); what
 * this script asks comes out of the same plan and is counted nowhere but in
 * RentCast's own dashboard. Twenty houses are 40 to 80 requests: more than
 * the free plan has, with or without the site. Past the plan's number every
 * request is charged.
 *
 * Nothing is kept between runs: each run asks again. --save <file> writes
 * what was read of each house (its facts and the sold homes, as flip keeps
 * them) to a file on this machine, to look at again without asking again.
 * An owner's name or mailing address is never read out of an answer
 * (lib/data/rentcast.ts), so none is printed or saved.
 */
import { writeFileSync } from "node:fs";
import { estimateArv, monthsBetween } from "../lib/engine/index.ts";
import { BudgetExhausted, MemoryDataStore, reserve, type DataBudget } from "../lib/data/budget.ts";
import { createHouseData } from "../lib/data/house-data.ts";
import { RENTCAST_BASE_URL, askRentcast, saleFrom, salesUrl } from "../lib/data/rentcast.ts";
import type { Sale } from "../lib/engine/index.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const max = Number(flag("max") ?? 4);
const point = flag("point");
const sqft = Number(flag("sqft") ?? 1_800);
const saveTo = flag("save");
const saved: unknown[] = [];
const addresses = args;

const key = process.env.RENTCAST_API_KEY?.trim();
if (!key) {
  console.error("Set RENTCAST_API_KEY (it is read from the environment and never printed).");
  process.exit(1);
}
if (!Number.isInteger(max) || max < 1 || (!point && addresses.length === 0)) {
  console.error('Usage: npm run rentcast:check -- [--max 4] [--save file.json] "street, city, ST zip" …   or   --point lat,lng [--sqft 1800]');
  process.exit(1);
}

console.log(`Up to ${max} real request${max === 1 ? "" : "s"} to RentCast. They come out of the same plan as the live site's, and the site's own count does not see them.\n`);
const budget: DataBudget = { requests: max, perPerson: max, windowDays: 31 };
const store = new MemoryDataStore();
const now = () => new Date();
const asOf = now().toISOString().slice(0, 10);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** How old the sales are, in quarters: the question is how long a sale takes to reach the records. */
function ages(sales: Sale[]): string {
  const buckets = [3, 6, 9, 12, 18, 24];
  const counts = buckets.map(() => 0);
  let older = 0;
  for (const s of sales) {
    const months = monthsBetween(s.saleDate, asOf);
    const i = buckets.findIndex((b) => months <= b);
    if (i >= 0) counts[i]++;
    else older++;
  }
  return buckets.map((b, i) => `${i === 0 ? 0 : buckets[i - 1]}-${b} mo: ${counts[i]}`).join(", ") + (older ? `, older: ${older}` : "");
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
};

if (point) {
  const [lat, lng] = point.split(",").map(Number);
  const step = { radiusMiles: 1, days: 366, sqft: [Math.floor((sqft * 0.7) / 50) * 50, Math.ceil((sqft * 1.3) / 50) * 50] as [number, number], propertyType: "Single Family" };
  try {
    const id = await reserve(store, budget, { provider: "rentcast", kind: "sales", userId: null, at: now() });
    const started = Date.now();
    const reply = await askRentcast(salesUrl(RENTCAST_BASE_URL, { lat, lng, ...step }), key, fetch, 30_000);
    await store.finish(id, { status: reply.status === 200 ? "billed" : "free", httpStatus: reply.status, results: reply.returned });
    const sales = reply.records.flatMap((r) => saleFrom(r) ?? []);
    console.log(`Around ${lat}, ${lng}: single-family homes of ${step.sqft[0]}-${step.sqft[1]} sqft sold within 1 mile in the last 12 months`);
    console.log(`  answer: HTTP ${reply.status} in ${Date.now() - started} ms; matched ${reply.total ?? "?"}, returned ${reply.returned}, readable ${reply.records.length}, usable as sales ${sales.length}`);
    if (sales.length) {
      const dates = sales.map((s) => s.saleDate).sort();
      console.log(`  sale dates from ${dates[0]} to ${dates[dates.length - 1]}`);
      console.log(`  by age: ${ages(sales)}`);
      console.log(`  median price ${money(median(sales.map((s) => s.price)))}, median per sqft ${money(median(sales.map((s) => s.price / s.sqft)))}`);
      const missing = (k: "beds" | "baths" | "yearBuilt" | "lotSqft" | "garage") => sales.filter((s) => s[k] === null).length;
      console.log(`  not on record, of ${sales.length}: beds ${missing("beds")}, baths ${missing("baths")}, year ${missing("yearBuilt")}, lot ${missing("lotSqft")}, garage spaces ${missing("garage")}`);
      console.log(`  zip codes: ${[...new Set(sales.map((s) => s.submarket))].sort().join(", ")}`);
    }
  } catch (err) {
    console.log(err instanceof BudgetExhausted ? "  --max reached: not asked." : `  no answer: ${err instanceof Error ? err.message : err}`);
  }
}

const houseData = createHouseData({ rentcast: () => ({ key, baseUrl: RENTCAST_BASE_URL, budget }), store, now });
for (const address of addresses) {
  console.log(`\n${address}`);
  const data = await houseData({ address, overrides: {}, userId: null, asOf });
  if (data.demo) {
    console.log(`  no real data: ${data.fallback?.code}: ${data.fallback?.message}`);
    continue;
  }
  saved.push({ asked: address, asOf, recorded: data.recorded, facts: data.facts, source: data.source, sales: data.sales });
  const { record, search } = data.source!;
  const r = data.recorded;
  console.log(`  record: ${record.address} | ${record.propertyType ?? "type not given"} | ${record.county ?? "?"} County`);
  console.log(`          ${r.sqft ?? "?"} sqft, ${r.beds ?? "?"} bd, ${r.baths ?? "?"} ba, built ${r.yearBuilt ?? "?"}, lot ${r.lotSqft ?? "?"} sqft, garage spaces ${r.garage ?? "not given"}`);
  console.log(`          last sold ${record.lastSale ? `${record.lastSale.date} for ${money(record.lastSale.price)}` : "never, on record"}`);
  console.log(`  search: ${search.found} sold homes within ${search.radiusMiles} mi / ${search.months} mo, ${search.usable} usable, newest ${search.newestSale ?? "none"}${search.sampled ? ` (more matched than one request returns: ${search.wholeWithinMiles === null ? "a part, not known to hold the nearest" : `whole within ${search.wholeWithinMiles} mi, a part beyond`})` : ""}${search.stoppedEarly ? " (a wider search could not be asked)" : ""}`);
  console.log(`          by age: ${ages(data.sales)}`);
  const arv = estimateArv(data.facts, data.sales, asOf, data.config, { tiers: data.tiers });
  if (Number.isNaN(arv.point)) {
    console.log("  engine: no usable comps");
    continue;
  }
  console.log(`  engine: ${arv.comps.length} comps within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo (±${arv.criteriaUsed.sqftTolerance * 100}% size), ${arv.confidence} confidence; left out: ${arv.leftOut.outliers} odd prices, ${arv.leftOut.overAdjusted} over-adjusted`);
  console.log(`          value as the comps sold: ${money(arv.point)} (${money(arv.low)} to ${money(arv.high)}); ceiling ${arv.ceiling ? `${money(arv.ceiling.value)} from ${arv.ceiling.sampleSize} sales` : "unknown"}`);
  for (const c of arv.comps) console.log(`          ${c.sale.saleDate} ${money(c.sale.price).padStart(10)} -> ${money(c.adjustedPrice).padStart(10)}  ${String(c.sale.sqft).padStart(5)} sqft  ${c.distanceMiles.toFixed(2)} mi  ${c.sale.address}`);
}

if (saveTo && saved.length) {
  writeFileSync(saveTo, JSON.stringify(saved, null, 1));
  console.log(`\nSaved ${saved.length} house${saved.length === 1 ? "" : "s"} to ${saveTo}.`);
}
const spent = store.requests.filter((q) => q.outcome.status !== "free").length;
console.log(`\nRequests sent: ${store.requests.length} (${spent} billed or unanswered, ${store.requests.length - spent} answered without a charge). Each billed one counts against the plan's month.`);
