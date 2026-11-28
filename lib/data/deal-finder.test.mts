import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, REAL_SALES_CONFIG, REAL_SALES_TIERS, evaluateDeal, estimateArv, rehabFromCondition } from "../engine/index.ts";
import { MemoryDataStore, type DataBudget } from "./budget.ts";
import { MAX_CHECK, createDealFinder, type DealSearch } from "./deal-finder.ts";
import { createHouseData } from "./house-data.ts";
import { saleFrom, recordFrom } from "./rentcast.ts";
import { HOME, TODAY, fakeRentcast, listing, record, soldHomes } from "./rentcast-fixtures.mts";

const BUDGET: DataBudget = { requests: 45, perPerson: 30, windowDays: 31 };
const SEARCH: DealSearch = { zips: ["98000"], price: [200_000, 600_000], targetProfit: 60_000, repair: "medium", propertyType: "Single Family" };

/**
 * An area: forty homes sold within a mile in the last year at about $520,000
 * (1,800 sqft), and homes for sale at prices that leave a lot, a little, or
 * nothing after a medium repair and every cost of the deal.
 */
function area() {
  const sold = soldHomes(40);
  const homes: [number, Parameters<typeof listing>[1]][] = [
    [501, { asking: 250_000, north: 0.1 }], // hot
    [502, { asking: 330_000, north: -0.1 }], // warm
    [503, { asking: 480_000, east: 0.1 }], // cold
    [504, { asking: 900_000, east: -0.1 }], // above the price range
    [505, { asking: 150_000, north: 0.2 }], // below it
    [506, { asking: 260_000, squareFootage: null }], // no living area
    [507, { asking: 240_000, north: 5 }], // five miles out: nothing sold near it
    [508, { asking: 245_000, north: 0.15, listingType: "Foreclosure" }], // hot
  ];
  const forSale = homes.map(([n, made]) => listing(n, made));
  // Each home for sale has a public record too, where the listing says it stands, for a closer look one by one.
  const records = [...sold, ...homes.map(([n, made]) => record(n, { north: made?.north, east: made?.east, squareFootage: made?.squareFootage }))];
  return { records, forSale };
}

function finder(records: Record<string, unknown>[], forSale: Record<string, unknown>[], over: { budget?: Partial<DataBudget>; deadlineMs?: number; store?: MemoryDataStore } = {}) {
  const api = fakeRentcast(records, forSale);
  const store = over.store ?? new MemoryDataStore();
  const clock = { now: TODAY };
  const settings = () => ({ key: "test-key", baseUrl: "https://api.test/v1", budget: { ...BUDGET, ...over.budget } });
  const fetcher = (url: string, init: Parameters<typeof api.fetch>[1]) => api.fetch(url, init);
  const houseData = createHouseData({ rentcast: settings, store, now: () => clock.now, fetcher });
  const f = createDealFinder({ rentcast: settings, store, now: () => clock.now, fetcher, houseData, deadlineMs: over.deadlineMs });
  const asked = () => api.calls.map((c) => c.kind);
  return { api, store, clock, f, asked };
}

test("not connected: nothing is searched and nothing is asked", async () => {
  const api = fakeRentcast([], []);
  const store = new MemoryDataStore();
  const f = createDealFinder({ rentcast: () => null, store, now: () => TODAY, fetcher: api.fetch, houseData: async () => assert.fail("not asked") });
  const answer = await f.find(SEARCH, "ann");
  assert.deepEqual([answer.connected, answer.homes, answer.areas, api.calls.length], [false, [], [], 0]);
});

test("one zip code: its homes for sale and its sold homes, two lookups, and every home valued and sorted", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const answer = await t.f.find(SEARCH, "ann");
  assert.equal(answer.connected, true);
  assert.deepEqual(t.asked(), ["listings", "area-sales"]);
  assert.deepEqual(t.store.requests.map((r) => `${r.kind}:${r.outcome.status}:${r.userId}`), ["listings:billed:ann", "area-sales:billed:ann"]);
  // What was asked: the zip code's active single homes, whatever their price; its single homes sold in the last twelve months.
  assert.deepEqual([t.api.calls[0].params.zipCode, t.api.calls[0].params.status, t.api.calls[0].params.propertyType, t.api.calls[0].params.price], ["98000", "Active", "Single Family", undefined]);
  assert.deepEqual([t.api.calls[1].params.zipCode, t.api.calls[1].params.saleDateRange, t.api.calls[1].params.propertyType], ["98000", "*:372", "Single Family"]);

  const area0 = answer.areas[0];
  assert.deepEqual([area0.zip, area0.status, area0.listings.found, area0.listings.sampled, area0.sales.found, area0.sales.usable, area0.sales.sampled], ["98000", "ok", 8, false, 40, 40, false]);
  // Two outside the price range; six in it.
  assert.equal(answer.outOfRange, 2);
  const heat = Object.fromEntries(answer.homes.map((h) => [h.listing.mlsNumber, h.screen.heat]));
  assert.deepEqual(heat, { F100501: "hot", F100508: "hot", F100502: "warm", F100503: "cold", F100506: "unknown", F100507: "unknown" });
  // Hot first, the most profit first; then warm, cold, and the ones that could not be valued.
  assert.deepEqual(answer.homes.map((h) => h.listing.mlsNumber), ["F100508", "F100501", "F100502", "F100503", "F100506", "F100507"].sort((a, b) => order(a) - order(b)));
  function order(mls: string) {
    const home = answer.homes.find((h) => h.listing.mlsNumber === mls)!;
    return answer.homes.indexOf(home);
  }
  assert.equal(answer.homes[0].screen.heat, "hot");
  assert.ok(answer.homes[0].screen.profit! >= answer.homes[1].screen.profit!);
  assert.match(answer.homes.find((h) => h.listing.mlsNumber === "F100506")!.why!, /does not give the living area/);
  assert.equal(answer.homes.find((h) => h.listing.mlsNumber === "F100507")!.why!, "No home of similar size sold within a mile of it in the last twelve months, in the zip codes searched.");
  assert.deepEqual([answer.inRange, answer.homes.length], [6, 6]);
  assert.equal(answer.homes.find((h) => h.listing.mlsNumber === "F100508")!.listing.listingType, "Foreclosure");
});

test("each home is valued the way an analysis would, with the chosen repair in place of the photos", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const answer = await t.f.find(SEARCH, "ann");
  const hot = answer.homes.find((h) => h.listing.mlsNumber === "F100501")!;
  // The same value, repair and deal math, computed here from the same sales.
  const sales = soldHomes(40).flatMap((r) => saleFrom(recordFrom(r)!) ?? []);
  const subject = { id: hot.listing.id, lat: hot.listing.lat, lng: hot.listing.lng, submarket: "98000", sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null, condition: "dated" as const };
  const arv = estimateArv(subject, sales, answer.asOf, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS.slice(0, 3) });
  const rehab = rehabFromCondition("dated", 1_800, REAL_SALES_CONFIG);
  const deal = evaluateDeal(arv.point, { ...DEFAULT_DEAL_TERMS, askingPrice: 250_000, rehab: rehab.likely });
  assert.deepEqual([hot.screen.arv?.point, hot.screen.profit, hot.screen.maxOffer, hot.screen.rehab.likely], [arv.point, deal.profit, deal.maxAllowableOffer, 42 * 1_800]);
  // The repair level is the person's: heavy costs more, and turns some homes from hot to warm.
  const heavy = await t.f.find({ ...SEARCH, repair: "heavy" }, "ann");
  const sameHome = heavy.homes.find((h) => h.listing.mlsNumber === "F100501")!;
  assert.equal(sameHome.screen.rehab.likely, 75 * 1_800);
  assert.ok(sameHome.screen.profit! < hot.screen.profit!);
  // And nothing was asked again: the profit target, the repair and the price range are worked out from what was kept.
  await t.f.find({ ...SEARCH, price: [100_000, 1_000_000], targetProfit: 120_000 }, "ann");
  assert.equal(t.api.calls.length, 2);
});

test("asked again within the day, a search costs nothing; a day on, the homes for sale are asked again and the sold homes are kept a week", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  await t.f.find(SEARCH, "ann");
  t.clock.now = new Date(TODAY.getTime() + 3 * 3_600_000);
  await t.f.find(SEARCH, "bob");
  assert.equal(t.api.calls.length, 2, "nothing was asked the second time");
  t.clock.now = new Date(TODAY.getTime() + 25 * 3_600_000);
  await t.f.find(SEARCH, "ann");
  assert.deepEqual(t.asked(), ["listings", "area-sales", "listings"]);
  t.clock.now = new Date(TODAY.getTime() + 8 * 86_400_000);
  await t.f.find(SEARCH, "ann");
  assert.deepEqual(t.asked(), ["listings", "area-sales", "listings", "listings", "area-sales"]);
});

test("what is kept never holds the listing agent's or the owner's name, phone or e-mail", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const answer = await t.f.find(SEARCH, "ann");
  for (const kept of t.store.cache.values()) assert.doesNotMatch(kept.payload, /Robin|Madeup|madeup\.invalid|5550100|agent|office|PO Box/i);
  assert.doesNotMatch(JSON.stringify(answer), /Robin|Madeup|madeup\.invalid|5550100|PO Box/i);
});

test("a home's own last sale is not one of its comps, whatever id its record has", async () => {
  const { records, forSale } = area();
  // The house at 501 sold four months ago for $200,000 and is for sale again: the flip being resold. Its sale record
  // carries another id than the listing, so only its address tells them to be the same house.
  const own = record(501, { north: 0.1 });
  const resold = records.map((r) => (r.formattedAddress === own.formattedAddress ? { ...record(501, { north: 0.1, soldDaysAgo: 120, soldFor: 200_000 }), id: "some-other-id" } : r));
  const withOwn = await finder(resold, forSale).f.find(SEARCH, "ann");
  const without = await finder(records, forSale).f.find(SEARCH, "ann");
  assert.equal(withOwn.areas[0].sales.found, 41, "its sale was read with the others");
  const [a, b] = [withOwn, without].map((answer) => answer.homes.find((h) => h.listing.mlsNumber === "F100501")!);
  assert.deepEqual([a.screen.arv?.point, a.screen.arv?.comps], [b.screen.arv?.point, b.screen.arv?.comps]);
  // Had it been taken, it would have counted: the nearest sale of all, at a third of the going rate, pulls the value down.
  const sales = resold.flatMap((r) => saleFrom(recordFrom(r)!) ?? []);
  const home = a.listing;
  const subject = { id: "someone else", lat: home.lat, lng: home.lng, submarket: "98000", sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null, condition: "dated" as const };
  const taken = estimateArv(subject, sales, withOwn.asOf, REAL_SALES_CONFIG, { tiers: REAL_SALES_TIERS.slice(0, 3) });
  assert.ok(taken.point < a.screen.arv!.point, `${taken.point} with its own sale, ${a.screen.arv!.point} without`);
});

test("where more are for sale or sold than RenoFlip reads, a part is read and said to be a part: three lookups a zip code at most", async () => {
  const many = Array.from({ length: 1_100 }, (_, i) => listing(1_000 + i, { asking: 400_000, north: (i % 30) * 0.02 }));
  const t = finder(soldHomes(1_600, { start: 3_000, withinMiles: 1 }), many);
  const answer = await t.f.find(SEARCH, "ann");
  // One page of homes for sale and two of sold homes: the most one zip code costs.
  assert.deepEqual(t.asked(), ["listings", "area-sales", "area-sales"]);
  assert.equal(t.api.calls[2].params.offset, "500");
  const { listings, sales } = answer.areas[0];
  assert.deepEqual([listings.found, listings.sampled, sales.found, sales.sampled], [500, true, 1_000, true]);
  // Exactly 500 for sale is all of them: no second page is asked, and nothing is said to be a part.
  const exact = finder(soldHomes(40), Array.from({ length: 500 }, (_, i) => listing(1_000 + i, { asking: 400_000 })));
  const whole = await exact.f.find(SEARCH, "ann");
  assert.deepEqual([exact.asked(), whole.areas[0].listings.sampled], [["listings", "area-sales"], false]);
  // 501 to 1,000 sold: the second page, and no third.
  const two = finder(soldHomes(700, { start: 3_000, withinMiles: 1 }), []);
  await two.f.find(SEARCH, "ann");
  assert.deepEqual(two.asked(), ["listings", "area-sales", "area-sales"]);
});

test("what a search may cost is said before it is made, from what is kept, asking nothing", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const before = await t.f.estimate({ ...SEARCH, zips: ["98000", "98001"] }, "ann");
  assert.deepEqual([before.connected, before.zips, before.upTo], [true, [{ zip: "98000", upTo: 3 }, { zip: "98001", upTo: 3 }], 6]);
  assert.equal(t.api.calls.length, 0, "an estimate asks nothing");
  await t.f.find(SEARCH, "ann");
  const after = await t.f.estimate(SEARCH, "ann");
  assert.deepEqual([after.upTo, t.api.calls.length], [0, 2]);
  // Another kind of home is another search.
  assert.equal((await t.f.estimate({ ...SEARCH, propertyType: "Condo" }, "ann")).upTo, 3);
  // Where the first page of sold homes says more sold than it holds, the second page is counted until it is kept.
  const many = finder(soldHomes(700, { start: 3_000, withinMiles: 1 }), forSale);
  await many.f.find(SEARCH, "ann");
  assert.equal((await many.f.estimate(SEARCH, "ann")).upTo, 0);
  many.store.cache.delete("rentcast:area-sales:v1:98000:Single Family:372:1");
  assert.equal((await many.f.estimate(SEARCH, "ann")).upTo, 1);
  // A day on, the homes for sale are asked again; the sold homes are still kept.
  many.clock.now = new Date(TODAY.getTime() + 25 * 3_600_000);
  many.store.cache.delete("rentcast:area-sales:v1:98000:Single Family:372:1");
  assert.equal((await many.f.estimate(SEARCH, "ann")).upTo, 2);
  // Nothing is counted when real sold prices are not connected.
  const off = createDealFinder({ rentcast: () => null, store: new MemoryDataStore(), now: () => TODAY, houseData: async () => assert.fail("not asked") });
  assert.deepEqual(await off.estimate(SEARCH, "ann"), { connected: false, zips: [], upTo: 0, lookups: null });
});

test("each zip code and each kind of home has answers of its own, never another's", async () => {
  const sold = [...soldHomes(40), ...soldHomes(40, { start: 200, around: { north: 10, east: 0 }, price: 900_000, made: { zipCode: "98001" } }), ...soldHomes(30, { start: 400, made: { propertyType: "Condo", squareFootage: 1_000 }, price: 300_000 })];
  const forSale = [listing(501, { asking: 250_000, north: 0.1 }), listing(601, { asking: 500_000, north: 10.1, zipCode: "98001" }), listing(701, { asking: 120_000, north: 0.05, propertyType: "Condo", squareFootage: 1_000 })];
  const t = finder(sold, forSale);
  const both = await t.f.find({ ...SEARCH, zips: ["98000", "98001"] }, "ann");
  assert.deepEqual(both.homes.map((h) => h.listing.mlsNumber).sort(), ["F100501", "F100601"]);
  assert.deepEqual(both.areas.map((a) => [a.zip, a.listings.found, a.sales.found]), [["98000", 1, 40], ["98001", 1, 40]]);
  // 98001's home is valued against 98001's sales (around $900,000), not 98000's.
  const far = both.homes.find((h) => h.listing.mlsNumber === "F100601")!;
  assert.ok(far.screen.arv!.point > 800_000, `${far.screen.arv!.point}`);
  // Condos: their own lookups, their own homes and sales.
  const condos = await t.f.find({ ...SEARCH, propertyType: "Condo", price: [50_000, 600_000] }, "ann");
  assert.deepEqual(condos.homes.map((h) => h.listing.mlsNumber), ["F100701"]);
  assert.deepEqual([condos.areas[0].sales.found, condos.homes[0].screen.arv!.point < 400_000], [30, true]);
  assert.deepEqual(t.api.calls.slice(4).map((c) => `${c.kind} ${c.params.propertyType}`), ["listings Condo", "area-sales Condo"]);
});

test("the budget used up: the zip code is not searched, the person is told when more open up, and nothing is sent past it", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale, { budget: { requests: 1 } });
  const answer = await t.f.find({ ...SEARCH, zips: ["98000", "98001"] }, "ann");
  // The homes for sale were read; the sold homes could not be: the zip code is not valued on half its data.
  assert.deepEqual(answer.areas.map((a) => a.status), ["budget", "budget"]);
  assert.match(answer.areas[0].message!, /^RenoFlip's real sold-price lookups are used up for now; more open up on December 11, so 98000 could not be searched\.$/);
  assert.deepEqual([answer.homes.length, t.api.calls.length], [0, 1]);
  assert.deepEqual(answer.lookups, { used: 1, of: 1, mine: 1, myShare: 30 });

  // A person's share used up is said as that.
  const share = finder(records, forSale, { budget: { perPerson: 1 } });
  const mine = await share.f.find(SEARCH, "ann");
  assert.equal(mine.areas[0].status, "your-share");
  assert.match(mine.areas[0].message!, /^You have used your share/);
});

test("the service down, or turning flip away: the zip code is said to be unread, with the reason, and the others still searched", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  t.api.fail = { status: 500, only: "listings" };
  const down = await t.f.find(SEARCH, "ann");
  assert.deepEqual([down.areas[0].status, down.homes.length], ["unavailable", 0]);
  assert.match(down.areas[0].message!, /did not answer for 98000 just now/);
  t.api.fail = { status: 401 };
  assert.equal((await t.f.find(SEARCH, "ann")).areas[0].status, "refused");
  t.api.fail = { noAnswer: true };
  assert.equal((await t.f.find(SEARCH, "ann")).areas[0].status, "unavailable");
  // A request that got no answer may have been billed: it is counted.
  assert.ok(t.store.requests.some((r) => r.outcome.status === "unknown"));
  t.api.fail = null;
  assert.equal((await t.f.find(SEARCH, "ann")).areas[0].status, "ok");
});

test("a zip code with nothing for sale or nothing sold is read, and simply has nothing to show", async () => {
  const t = finder([], []);
  const answer = await t.f.find(SEARCH, "ann");
  assert.deepEqual([answer.areas[0].status, answer.areas[0].listings.found, answer.areas[0].sales.found, answer.homes.length], ["ok", 0, 0, 0]);
  // "Nothing matched" is free and is kept: asked again, nothing is sent.
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["free", "free"]);
  await t.f.find(SEARCH, "ann");
  assert.equal(t.api.calls.length, 2);
});

test("all the asking for one search has a time limit, and a zip code it did not reach is said as that, not as a silent service", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale, { deadlineMs: 2_100 });
  t.api.delayMs = 400;
  const started = performance.now();
  const answer = await t.f.find({ ...SEARCH, zips: ["98000", "98001", "98002", "98003", "98004"] }, "ann");
  assert.ok(performance.now() - started < 2_100 + 1_500, `answered in ${Math.round(performance.now() - started)} ms`);
  const late = answer.areas.filter((a) => a.status === "late");
  assert.ok(late.length > 0, JSON.stringify(answer.areas.map((a) => a.status)));
  for (const area of late) {
    assert.match(area.message!, new RegExp(`^The search ran out of time before ${area.zip} was read in full\\. Search again to include it`));
    assert.doesNotMatch(area.message!, /did not answer/);
  }
  // The zip codes it never reached had nothing sent for them.
  const never = late.filter((a) => !t.api.calls.some((c) => c.params.zipCode === a.zip)).length;
  assert.ok(never > 0);
});

test("turned away, the zip code is named", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  t.api.fail = { status: 403 };
  const answer = await t.f.find(SEARCH, "ann");
  assert.match(answer.areas[0].message!, /^The service RenoFlip reads homes for sale from turned RenoFlip away, so 98000 could not be searched\./);
});

test("a home that cannot be valued says which: nothing of its size sold near it, or sales left out for what differs", async () => {
  const odd = listing(501, { asking: 250_000, north: 0.1, bedrooms: 30, bathrooms: 30 });
  const t = finder(soldHomes(40), [odd]);
  const home = (await t.f.find(SEARCH, "ann")).homes[0];
  assert.equal(home.screen.heat, "unknown");
  assert.match(home.why!, /^\d+ homes of similar size sold within a mile of it, but none is close enough to it, once what differs between them is counted, to value it from\.$/);
});

test("an answer lists the most promising thousand homes, and says how many there were", async () => {
  const forSale = ["98000", "98001", "98002"].flatMap((zip, z) => Array.from({ length: 500 }, (_, i) => listing(10_000 + z * 1_000 + i, { asking: 300_000 + i, zipCode: zip, north: z * 20 + (i % 20) * 0.01 })));
  const t = finder([], forSale);
  const answer = await t.f.find({ ...SEARCH, zips: ["98000", "98001", "98002"] }, "ann");
  assert.deepEqual([answer.inRange, answer.homes.length], [1_500, 1_000]);
});

test("a closer look at chosen homes: each one's own record and the homes sold right around it", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const first = await t.f.find(SEARCH, "ann");
  const hot = first.homes.filter((h) => h.screen.heat === "hot").map((h) => h.listing.id);
  const checked = await t.f.check(SEARCH, hot, "ann");
  // The search came from what was kept; each home then cost its record and a search around it.
  assert.deepEqual(t.asked(), ["listings", "area-sales", "property", "sales", "property", "sales"]);
  for (const home of checked.homes.filter((h) => hot.includes(h.listing.id))) {
    assert.equal(home.checked?.status, "ok");
    assert.equal(home.checked?.source?.record.address, home.listing.address);
    assert.ok(home.checked?.screen?.arv && home.checked.screen.arv.comps >= 5);
  }
  assert.ok(checked.homes.filter((h) => !hot.includes(h.listing.id)).every((h) => h.checked === undefined));
});

test("a closer look is at most five homes, and a home whose record cannot be found is said as that", async () => {
  const { records, forSale } = area();
  const gone = record(502, { north: -0.1 }).formattedAddress;
  const t = finder(records.filter((r) => r.formattedAddress !== gone), forSale);
  const wide = { ...SEARCH, price: [0, 2_000_000] as [number, number] };
  const first = await t.f.find(wide, "ann");
  const missing = first.homes.find((h) => h.listing.mlsNumber === "F100502")!.listing.id;
  const ids = [missing, ...first.homes.map((h) => h.listing.id).filter((id) => id !== missing)];
  assert.ok(ids.length > MAX_CHECK);
  const checked = await t.f.check(wide, ids, "ann");
  assert.equal(checked.homes.filter((h) => h.checked).length, MAX_CHECK);
  const home = checked.homes.find((h) => h.listing.id === missing)!;
  assert.equal(home.checked?.status, "demo");
  assert.match(home.checked!.message!, /have no property at 602 Sample St, Fixture Falls, WA 98000/);
  // The sixth and later were not looked at, and cost nothing.
  assert.equal(t.api.calls.filter((c) => c.kind === "property").length, MAX_CHECK);
});

test("the lookups of the month are counted for the person: everyone's and their own", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const bob = await t.f.find(SEARCH, "bob");
  assert.deepEqual(bob.lookups, { used: 2, of: 45, mine: 2, myShare: 30 });
  // Ann's search is answered from what Bob's kept: it costs her nothing, and her own count says so.
  const ann = await t.f.find(SEARCH, "ann");
  assert.deepEqual(ann.lookups, { used: 2, of: 45, mine: 0, myShare: 30 });
  assert.ok(HOME.lat > 0);
});

test("a closer look works from the search as it was kept: a zip code that was not kept is not searched, and costs nothing", async () => {
  const { records, forSale } = area();
  const t = finder(records, forSale);
  const first = await t.f.find(SEARCH, "ann");
  const hot = first.homes.filter((h) => h.screen.heat === "hot").map((h) => h.listing.id);
  // The closer look is asked with one more zip code than was searched: that one is not searched now.
  const checked = await t.f.check({ ...SEARCH, zips: ["98000", "98001"] }, hot, "ann");
  assert.deepEqual(t.asked(), ["listings", "area-sales", "property", "sales", "property", "sales"]);
  assert.deepEqual(checked.areas.map((a) => [a.zip, a.status]), [["98000", "ok"], ["98001", "not-kept"]]);
  assert.match(checked.areas[1].message!, /^98001 is not in the search as it was kept today/);
  // The same homes as before, no more.
  assert.deepEqual(checked.homes.map((h) => h.listing.id), first.homes.map((h) => h.listing.id));
  // A home that is not in the kept search is said to be missing, and nothing is asked for it.
  const again = await t.f.check(SEARCH, ["not-a-listing"], "ann");
  assert.deepEqual([again.notFound, t.api.calls.length], [["not-a-listing"], 6]);
});

test("a closer look lists the sales its value was drawn from, and uses the listing's facts and the repair chosen", async () => {
  const sold = soldHomes(40);
  // The listing says 2,100 sqft and 4 bedrooms; the public record says 1,800 and 3.
  const forSale = [listing(501, { asking: 250_000, north: 0.1, squareFootage: 2_100, bedrooms: 4 })];
  const t = finder([...sold, record(501, { north: 0.1 })], forSale);
  const heavy = { ...SEARCH, repair: "heavy" as const };
  const first = await t.f.find(heavy, "ann");
  const checked = await t.f.check(heavy, [first.homes[0].listing.id], "ann");
  const c = checked.homes[0].checked!;
  assert.equal(c.status, "ok");
  // The repair is priced on the listing's size at the heavy rate.
  assert.equal(c.screen!.rehab.likely, 75 * 2_100);
  // Every sale the value was drawn from, with its address, price, day and distance.
  assert.equal(c.screen!.comps!.length, c.screen!.arv!.comps);
  for (const comp of c.screen!.comps!) {
    assert.match(comp.address!, /^\d+ Sample St, Fixture Falls, WA 98000$/);
    assert.ok(comp.price > 400_000 && /^\d{4}-\d{2}-\d{2}$/.test(comp.saleDate) && comp.distanceMiles >= 0 && comp.distanceMiles <= 1);
  }
  // The first look of a whole area lists no sales: only a closer look does.
  assert.equal(first.homes[0].screen.comps, undefined);
  // And the month's lookups are counted again after it: the search's two and the closer look's two.
  assert.deepEqual([first.lookups?.used, checked.lookups?.used], [2, 4]);
});

test("a closer look keeps one clock from the moment it is asked: a home it cannot start in time is skipped, and says so", async () => {
  const { records, forSale } = area();
  const api = fakeRentcast(records, forSale);
  const store = new MemoryDataStore();
  const settings = () => ({ key: "test-key", baseUrl: "https://api.test/v1", budget: BUDGET });
  const houseData = createHouseData({ rentcast: settings, store, now: () => TODAY, fetcher: api.fetch });
  const f = createDealFinder({ rentcast: settings, store, now: () => TODAY, fetcher: api.fetch, houseData, checkDeadlineMs: 1_000, houseLimitMs: 800 });
  const first = await f.find(SEARCH, "ann");
  api.delayMs = 150;
  const hot = first.homes.filter((h) => h.screen.heat === "hot").map((h) => h.listing.id);
  const checked = await f.check(SEARCH, hot, "ann");
  const statuses = hot.map((id) => checked.homes.find((h) => h.listing.id === id)!.checked?.status);
  assert.deepEqual(statuses, ["ok", "skipped"]);
  assert.equal(checked.homes.find((h) => h.listing.id === hot[1])!.checked!.message, "Not reached this time. Check it again.");
});

test("a home's own last sale is left out by its id too, where its record writes the address another way", async () => {
  const { records, forSale } = area();
  const own = record(501, { north: 0.1 });
  // Same id as the listing, address written with a unit the listing does not have: only the id says it is the same house.
  const resold = records.map((r) => (r.formattedAddress === own.formattedAddress ? { ...record(501, { north: 0.1, soldDaysAgo: 120, soldFor: 200_000 }), formattedAddress: "601 Sample St Unit A, Fixture Falls, WA 98000" } : r));
  const withOwn = await finder(resold, forSale).f.find(SEARCH, "ann");
  const without = await finder(records, forSale).f.find(SEARCH, "ann");
  const [a, b] = [withOwn, without].map((answer) => answer.homes.find((h) => h.listing.mlsNumber === "F100501")!);
  assert.equal(withOwn.areas[0].sales.found, 41);
  assert.deepEqual([a.screen.arv?.point, a.screen.arv?.comps], [b.screen.arv?.point, b.screen.arv?.comps]);
});
