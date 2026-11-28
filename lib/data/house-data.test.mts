import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKET_CONFIG, REAL_SALES_CONFIG, REAL_SALES_TIERS, RELAXATION_TIERS } from "../engine/index.ts";
import { addressKey } from "./address-match.ts";
import { DEFAULT_DATA_BUDGET, MemoryDataStore, type DataBudget } from "./budget.ts";
import { MAX_SEARCHES, createHouseData, rentcastFromEnv, type HouseAsk } from "./house-data.ts";
import { RENTCAST_BASE_URL, recordFrom } from "./rentcast.ts";
import { SUBJECT_ADDRESS, TODAY, fakeRentcast, record, soldHomes, subjectRecord } from "./rentcast-fixtures.mts";

const BUDGET: DataBudget = { requests: 45, perPerson: 30, windowDays: 31 };

/** flip with RentCast connected to a stand-in API holding these records. */
function connected(records: Record<string, unknown>[], over: { budget?: Partial<DataBudget>; off?: boolean; deadlineMs?: number; bookkeepingMs?: number; store?: MemoryDataStore } = {}) {
  const api = fakeRentcast(records);
  const store = over.store ?? new MemoryDataStore();
  const clock = { now: TODAY };
  const houseData = createHouseData({
    rentcast: () => (over.off ? null : { key: "test-key", baseUrl: "https://api.test/v1", budget: { ...BUDGET, ...over.budget } }),
    store,
    now: () => clock.now,
    // Through the stand-in as it stands at the moment of asking, so a test can swap it.
    fetcher: (url, init) => api.fetch(url, init),
    deadlineMs: over.deadlineMs,
    bookkeepingMs: over.bookkeepingMs,
  });
  const ask = (more: Partial<HouseAsk> = {}) => houseData({ address: SUBJECT_ADDRESS, overrides: {}, userId: "ann", asOf: "2026-11-10", ...more });
  const asked = () => api.calls.map((c) => (c.kind === "property" ? "property" : `sales ${c.params.radius} mi`));
  const billed = () => store.requests.filter((r) => r.outcome.status !== "free").length;
  return { api, store, clock, ask, asked, billed };
}

/** What makes every sold home impossible to compare with: thirty bedrooms and bathrooms is over a quarter of any price in adjustments. */
const NOTHING_COMPARES = { beds: 30, baths: 30 };
const NEXT_DOOR = "4823 Orchard Loop Rd, Fixture Falls, WA 98000";

test("not connected: every house gets the demo's made-up data, and nothing is asked of anybody", async () => {
  const t = connected([subjectRecord(), ...soldHomes(30)], { off: true });
  const data = await t.ask();
  assert.deepEqual([data.provider, data.demo, data.fallback, data.source], ["synthetic", true, undefined, undefined]);
  assert.deepEqual([data.config, data.tiers], [DEFAULT_MARKET_CONFIG, RELAXATION_TIERS]);
  assert.equal(data.sales.length, 600);
  assert.equal(t.api.calls.length, 0);
  assert.equal(t.store.requests.length, 0);
});

test("connected, in a town: the house's own record and one search, two requests, and both are real", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  const data = await t.ask({ overrides: { sqft: 1_850, beds: 4 } });
  assert.deepEqual([data.provider, data.demo, data.fallback], ["rentcast", false, undefined]);
  assert.deepEqual(t.asked(), ["property", "sales 1 mi"]);
  // The engine widens no further than the search did: a mile and a year.
  assert.deepEqual([data.config, data.tiers], [REAL_SALES_CONFIG, REAL_SALES_TIERS.slice(0, 3)]);

  // The record, as RentCast gave it; and what the valuation uses: the listing's size and bedrooms over the record's.
  assert.deepEqual(data.recorded, { sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null });
  assert.deepEqual([data.facts.sqft, data.facts.beds, data.facts.baths, data.facts.yearBuilt, data.facts.lotSqft, data.facts.garage, data.facts.submarket], [1_850, 4, 2, 1984, 7_200, null, "98000"]);
  assert.ok(Math.abs(data.facts.lat - 47.1) < 1e-9 && Math.abs(data.facts.lng + 122.3) < 1e-9);

  // The sold homes: every one with its address, a price, a date, and no condition. The house itself is not its own comp.
  assert.equal(data.sales.length, 40);
  assert.ok(data.sales.every((s) => s.condition === "unknown" && s.address && s.price > 100_000 && /^\d{4}-\d{2}-\d{2}$/.test(s.saleDate)));
  assert.ok(!data.sales.some((s) => s.id === data.facts.id));

  // Where it came from, for the report.
  assert.equal(data.source?.name, "RentCast");
  assert.equal(data.source?.record.address, SUBJECT_ADDRESS);
  assert.equal(data.source?.record.lastSale?.price, 365_000);
  const s = data.source!.search;
  assert.deepEqual([s.radiusMiles, s.months, s.found, s.usable, s.sampled, s.stoppedEarly], [1, 12, 40, 40, false, false]);
  assert.match(s.newestSale!, /^2026-/);

  // Both requests are on the record as billed, to the person who asked; both went out uncached and would not have followed a redirect.
  assert.deepEqual(t.store.requests.map((r) => [r.kind, r.userId, r.outcome.status]), [["property", "ann", "billed"], ["sales", "ann", "billed"]]);
  assert.ok(t.api.calls.every((c) => c.redirect === "error" && c.cache === "no-store" && c.key === "test-key"));
});

test("a house that itself sold lately is not counted among the homes sold around it", async () => {
  const t = connected([subjectRecord({ soldDaysAgo: 100, soldFor: 500_000 }), ...soldHomes(40)]);
  const data = await t.ask();
  assert.deepEqual([data.source?.search.found, data.sales.length], [40, 40]);
  assert.ok(!data.sales.some((s) => s.address === SUBJECT_ADDRESS));
});

test("asked again within the week, a house costs nothing: both answers were kept", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  const first = await t.ask();
  // Six days on (the valuation date is the day of asking, as in the app).
  t.clock.now = new Date(TODAY.getTime() + 6 * 86_400_000);
  const again = await t.ask({ userId: "bob", asOf: "2026-11-16" });
  assert.equal(t.api.calls.length, 2, "nothing was asked the second time");
  assert.deepEqual(again.sales, first.sales);
  assert.equal(again.source?.record.readAt, first.source?.record.readAt, "the result says when the record was really read");
  assert.equal(t.store.requests.length, 2, "and nothing was charged to the second person");

  // A sale takes weeks to reach the records, so the search is asked again after a week; the house's own record is kept a month.
  t.clock.now = new Date(TODAY.getTime() + 8 * 86_400_000);
  await t.ask({ asOf: "2026-11-18" });
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 1 mi"]);
  t.clock.now = new Date(TODAY.getTime() + 31 * 86_400_000);
  await t.ask({ asOf: "2026-12-11" });
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 1 mi", "property", "sales 1 mi"]);
});

test("the same question is paid for once, however the address is written and whatever hundred the size rounds within", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  await t.ask({ overrides: { sqft: 1_810 } });
  assert.equal(t.billed(), 2);
  // Five ways to write one address.
  for (const address of ["4821 Orchard Loop Road, Fixture Falls, WA 98000", "4821 Orchard Loop Rd., Fixture Falls, WA 98000-1234", "4821 ORCHARD LOOP RD, FIXTURE FALLS, WA 98000", "4821 Orchard Loop Rd,  Fixture Falls,  WA  98000", "4821 Orchard Loop Rd, Fixture Falls, WA 98000, USA"]) {
    assert.equal((await t.ask({ address, overrides: { sqft: 1_810 } })).demo, false, address);
  }
  // The listing said 1,810; the record says 1,800; a second listing says 1,840. One question.
  await t.ask({ overrides: {} });
  await t.ask({ overrides: { sqft: 1_840 } });
  assert.equal(t.billed(), 2, `asked: ${t.asked().join(", ")}`);
  // 1,860 is nearer 1,900: homes of other sizes come into it, and that is another question.
  await t.ask({ overrides: { sqft: 1_860 } });
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 1 mi"]);
});

test("two runs for one house at the same moment pay for its data once", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  t.api.delayMs = 15;
  const [one, two] = await Promise.all([t.ask(), t.ask({ userId: "bob" })]);
  assert.deepEqual([one.demo, two.demo, one.sales.length, two.sales.length], [false, false, 40, 40]);
  assert.equal(t.api.calls.length, 2);
  assert.equal(t.billed(), 2);
});

test("only an answer is shared: someone waiting on a question that was refused for another's share asks for themselves", async () => {
  // Ann has used her share. Ann and Bob ask about the same new house at the same moment.
  const t = connected([subjectRecord(), ...soldHomes(40), record(900, { address: "77 Other Way, Fixture Falls, WA 98000" })], { budget: { perPerson: 2 } });
  assert.equal((await t.ask()).demo, false);
  t.api.delayMs = 15;
  const [ann, bob] = await Promise.all([t.ask({ address: "77 Other Way, Fixture Falls, WA 98000" }), t.ask({ address: "77 Other Way, Fixture Falls, WA 98000", userId: "bob" })]);
  assert.deepEqual([ann.demo, ann.fallback?.code], [true, "your-share"]);
  assert.deepEqual([bob.demo, bob.fallback], [false, undefined], "Bob has asked for nothing: he is not told he used his share");
  // He paid for the house's record himself. (The sold homes around that spot were already kept, from Ann's first house.)
  assert.deepEqual(t.store.requests.filter((r) => r.userId === "bob").map((r) => [r.kind, r.outcome.status]), [["property", "billed"]]);

  // Nor is a refusal by the service an answer: the one who waited on it asks again, and may be answered.
  const down = connected([subjectRecord(), ...soldHomes(40)]);
  down.api.delayMs = 15;
  let first = true;
  const real = down.api.fetch;
  down.api.fetch = async (url, init) => {
    const refuse = first;
    first = false;
    const answer = await real(url, init);
    return refuse ? new Response("{}", { status: 500 }) : answer;
  };
  const [one, two] = await Promise.all([down.ask(), down.ask({ userId: "bob" })]);
  assert.deepEqual([one.demo, one.fallback?.code, two.demo], [true, "unavailable", false]);

  // "No such address" is the answer to one asking, and costs nothing: it is not shared and not kept. Each asks.
  const none = connected([subjectRecord(), ...soldHomes(40)]);
  none.api.delayMs = 15;
  const [a, b] = await Promise.all([none.ask({ address: "9 Nowhere Rd, Fixture Falls, WA 98000" }), none.ask({ address: "9 Nowhere Rd, Fixture Falls, WA 98000", userId: "bob" })]);
  assert.deepEqual([a.fallback?.code, b.fallback?.code, none.api.calls.length], ["not-found", "not-found", 2]);
  assert.deepEqual([none.billed(), none.store.cache.size], [0, 0]);
});

test("an answer that is not the house's is the answer to one writing of its address, and is never said of another", async () => {
  // A service that finds the house under its city's right name and not under a misspelling of it.
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  const misspelt = "4821 Orchard Loop Rd, Fixture Fals, WA 98000";
  const wrong = await t.ask({ address: misspelt });
  assert.deepEqual([wrong.demo, wrong.fallback?.code], [true, "not-found"]);
  // The address rightly written was never asked about: it is asked, and found. Nobody is told "no property at" it
  // on the strength of another writing, though the two share a zip code, a number and a street.
  assert.equal(addressKey(misspelt), addressKey(SUBJECT_ADDRESS));
  const right = await t.ask();
  assert.deepEqual([right.demo, right.fallback, t.asked()], [false, undefined, ["property", "property", "sales 1 mi"]]);

  // The same with another house's record for an answer: kept a day for "#4" as it was written, and not said of "Apt 4".
  const building = [record(1, { address: "500 Main St, Unit 12, Fixture Falls, WA 98000", propertyType: "Condo" }), record(2, { address: "500 Main St, Apt 4, Fixture Falls, WA 98000", propertyType: "Condo", squareFootage: 900 })];
  const units = connected([...building, ...soldHomes(40)]);
  const searches = units.api.fetch;
  // It answers "#4" with unit 12, and "Apt 4" with unit 4.
  units.api.fetch = async (url, init) => {
    const address = new URL(url).searchParams.get("address");
    if (address === null) return searches(url, init);
    units.api.calls.push({ kind: "property", url, params: { address }, key: null, redirect: init.redirect, cache: init.cache });
    return new Response(JSON.stringify([/#4/.test(address) ? building[0] : building[1]]), { status: 200 });
  };
  const hash = "500 Main St #4, Fixture Falls, WA 98000";
  const apt = "500 Main St Apt 4, Fixture Falls, WA 98000";
  assert.equal(addressKey(hash), addressKey(apt));
  const first = await units.ask({ address: hash });
  assert.deepEqual([first.fallback?.code, /with the record of 500 Main St, Unit 12,/.test(first.fallback!.message)], ["not-matched", true]);
  // The same writing again that day: not paid for twice.
  assert.equal((await units.ask({ address: hash })).fallback?.code, "not-matched");
  assert.equal(units.api.calls.filter((c) => c.kind === "property").length, 1);
  // The other writing: asked, and it is the unit.
  const second = await units.ask({ address: apt });
  assert.deepEqual([second.demo, second.recorded.sqft, units.api.calls.filter((c) => c.kind === "property").length], [false, 900, 2]);
  // And now that the unit's own record is kept, "#4" is given it too: by the address rule that record is this
  // unit's, however the unit is marked, and a record that passes the rule is what every writing of the house shares.
  const third = await units.ask({ address: hash });
  assert.deepEqual([third.demo, third.source?.record.address, units.api.calls.filter((c) => c.kind === "property").length], [false, "500 Main St, Apt 4, Fixture Falls, WA 98000", 2]);
});

test("when a question fails for the one who asked it, one of those waiting asks and the rest wait for that one", async () => {
  // Three runs for one house at the same moment. The first request gets no answer.
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  t.api.delayMs = 15;
  let first = true;
  const real = t.api.fetch;
  t.api.fetch = async (url, init) => {
    if (first) {
      first = false;
      t.api.calls.push({ kind: "property", url, params: {}, key: null, redirect: init.redirect, cache: init.cache });
      await new Promise((done) => setTimeout(done, 15));
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return real(url, init);
  };
  const [ann, bob, cat] = await Promise.all([t.ask(), t.ask({ userId: "bob" }), t.ask({ userId: "cat" })]);
  assert.deepEqual([ann.fallback?.code, bob.demo, cat.demo], ["unavailable", false, false]);
  // The record was asked for twice in all (once unanswered, once by the first of those waiting), the sold homes once.
  assert.deepEqual(t.store.requests.map((r) => `${r.kind}:${r.outcome.status}`), ["property:unknown", "property:billed", "sales:billed"], `by ${t.store.requests.map((r) => r.userId).join(", ")}`);
});

test("a run that waits on another run's question waits no longer than its own time, and then does not ask as well", async () => {
  // The first run has ten seconds and a service that takes its request and does not answer. The second run, for the
  // same house, has two: it waits on the first one's question for its own two seconds and no longer.
  const api = fakeRentcast([subjectRecord(), ...soldHomes(40)]);
  const store = new MemoryDataStore();
  const limits = { deadlineMs: 10_000 };
  let release = () => {};
  const houseData = createHouseData({
    rentcast: () => ({ key: "test-key", baseUrl: "https://api.test/v1", budget: BUDGET }),
    store,
    now: () => TODAY,
    fetcher: (url, init) => {
      api.calls.push({ kind: "property", url, params: {}, key: null, redirect: init.redirect, cache: init.cache });
      return new Promise((_, reject) => {
        release = () => reject(new DOMException("The operation timed out.", "TimeoutError"));
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
    get deadlineMs() {
      return limits.deadlineMs;
    },
    bookkeepingMs: 60,
  });
  const ask = (userId: string) => houseData({ address: SUBJECT_ADDRESS, overrides: {}, userId, asOf: "2026-11-10" });
  const first = ask("ann");
  await new Promise((done) => setTimeout(done, 100));
  limits.deadlineMs = 2_100;
  const started = performance.now();
  const second = await Promise.race([ask("bob"), new Promise<"still waiting">((done) => setTimeout(() => done("still waiting"), 3_500))]);
  const took = performance.now() - started;
  assert.notEqual(second, "still waiting", "the second run was held past its own time by the first one's question");
  assert.deepEqual([(second as Awaited<ReturnType<typeof houseData>>).demo, (second as Awaited<ReturnType<typeof houseData>>).fallback?.code], [true, "unavailable"]);
  assert.ok(took < 2_100 + 400, `it was answered inside its own limit: ${Math.round(took)} ms`);
  assert.equal(api.calls.length, 1, "and it did not send a request of its own with no time left for it");
  // The first run's request then fails: it is on the record as one that may have been billed, and nothing else is.
  release();
  assert.equal((await first).fallback?.code, "unavailable");
  assert.deepEqual(store.requests.map((r) => `${r.userId}:${r.outcome.status}`), ["ann:unknown"]);
});

test("the caller has its answer inside the limit even while the bookkeeping of a request is still going, and that request is kept", async () => {
  // The request is answered at once; writing it down as finished takes three and a half seconds. The bookkeeping's
  // own allowance (eight seconds by default) would let the run take that long. The run's limit does not.
  class SlowToFinish extends MemoryDataStore {
    async finish(id: string, outcome: Parameters<MemoryDataStore["finish"]>[1]): Promise<void> {
      await new Promise((done) => setTimeout(done, 3_500));
      return super.finish(id, outcome);
    }
  }
  const store = new SlowToFinish();
  const t = connected([subjectRecord(), ...soldHomes(40)], { store, deadlineMs: 2_100 });
  const started = performance.now();
  const data = await t.ask();
  const took = performance.now() - started;
  assert.deepEqual([data.demo, data.fallback?.code], [true, "unavailable"]);
  assert.ok(took < 2_100 + 400, `answered inside the limit: ${Math.round(took)} ms`);
  // The request that was sent is finished underneath: recorded as billed and its answer kept, and nothing more was
  // sent for a run that was over.
  await new Promise((done) => setTimeout(done, 1_900));
  assert.deepEqual([t.asked(), store.requests.map((r) => r.outcome.status), store.cache.size], [["property"], ["billed"], 1]);
});

test("a database that does not answer does not hold a run past its time", async () => {
  // Reading what was kept never comes back; nor, then, does the count.
  class Silent extends MemoryDataStore {
    async cacheGet(): Promise<null> {
      return new Promise(() => {});
    }
    async start(): Promise<string> {
      return new Promise(() => {});
    }
  }
  const t = connected([subjectRecord(), ...soldHomes(40)], { store: new Silent(), deadlineMs: 2_100, bookkeepingMs: 60 });
  const socket = setTimeout(() => {}, 10_000);
  const started = performance.now();
  const data = await t.ask();
  clearTimeout(socket);
  assert.deepEqual([data.demo, data.fallback?.code], [true, "unavailable"]);
  assert.ok(performance.now() - started < 2_100 + 400, `answered inside the limit: ${Math.round(performance.now() - started)} ms`);
  assert.equal(t.api.calls.length, 0, "what could not be counted was not sent");
});

test("a request is not sent once its run has given up, and does not stay on the record", async () => {
  // The count before the request takes longer than the run has.
  class Slow extends MemoryDataStore {
    async start(row: Parameters<MemoryDataStore["start"]>[0]): Promise<string> {
      await new Promise((done) => setTimeout(done, 2_500));
      return super.start(row);
    }
  }
  const store = new Slow();
  const t = connected([subjectRecord(), ...soldHomes(40)], { store, deadlineMs: 2_100, bookkeepingMs: 60 });
  const data = await t.ask();
  assert.deepEqual([data.demo, data.fallback?.code], [true, "unavailable"]);
  // The count comes back after the run was given up on: nothing is sent then, and the row is taken back.
  await new Promise((done) => setTimeout(done, 700));
  assert.equal(t.api.calls.length, 0);
  assert.equal(store.requests.length, 0);
});

test("a question that never finishes does not hold up the next run for the same house", async () => {
  // The database stops answering when the first request is to be written down as finished.
  class Stuck extends MemoryDataStore {
    stuck = true;
    async finish(id: string, outcome: Parameters<MemoryDataStore["finish"]>[1]): Promise<void> {
      if (this.stuck) await new Promise(() => {});
      return super.finish(id, outcome);
    }
  }
  const store = new Stuck();
  const t = connected([subjectRecord(), ...soldHomes(40)], { store, deadlineMs: 2_100, bookkeepingMs: 60 });
  // (A real connection holds a socket open while it waits; this timer stands in for one.)
  const socket = setTimeout(() => {}, 10_000);
  const started = performance.now();
  const first = await t.ask();
  clearTimeout(socket);
  assert.deepEqual([first.demo, first.fallback?.code], [true, "unavailable"]);
  assert.ok(performance.now() - started < 4_000, "the first run gave up inside its own time");
  // What was sent stays counted: it may have been billed.
  assert.equal(t.billed(), 1);
  store.stuck = false;
  const next = await t.ask();
  assert.equal(next.demo, false, "the next run is not left waiting on the first one's question");
});

test("what is kept of an answer never holds an owner's name or mailing address", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  await t.ask();
  assert.equal(t.store.cache.size, 2);
  for (const kept of t.store.cache.values()) assert.doesNotMatch(kept.payload, /Madeup|PO Box|mailing|owner|LOT 1 OF/i);
});

test("no address, no lookup: the demo's data, the reason in words, and no request", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  const data = await t.ask({ address: undefined });
  assert.deepEqual([data.provider, data.demo, data.fallback?.code], ["synthetic", true, "no-address"]);
  assert.match(data.fallback!.message, /No address came with this listing/);
  assert.equal(t.api.calls.length, 0);
  assert.equal((await t.ask({ address: "   " })).fallback?.code, "no-address");
});

test("an address the records do not have: the demo's data, said as that, and not charged to the budget", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  const data = await t.ask({ address: "9 Nowhere Rd, Fixture Falls, WA 98000" });
  assert.deepEqual([data.demo, data.fallback?.code], [true, "not-found"]);
  assert.match(data.fallback!.message, /have no property at 9 Nowhere Rd, Fixture Falls, WA 98000\. Check the address on the listing/);
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["free"]);
});

test("an answer about the house next door is not this house's record, however the address was written", async () => {
  // A service that places addresses on a map can answer one it does not have with the nearest it does: here, number 4823.
  const t = connected([record(1, { address: NEXT_DOOR, squareFootage: 2_950, bedrooms: 5 }), ...soldHomes(40)]);
  t.api.nearest = true;
  for (const address of [SUBJECT_ADDRESS, "4821 Orchard Loop Rd, Fixture Falls, WA", "4821 Orchard Loop Rd, Fixture Falls, WA 98000, USA", "4821 Orchard Loop Rd"]) {
    const data = await t.ask({ address });
    assert.deepEqual([data.demo, data.fallback?.code], [true, "not-matched"], address);
    // The person is not told that the records have no such property: a record came back, and it is named.
    assert.match(data.fallback!.message, /answered .+ with the record of 4823 Orchard Loop Rd, Fixture Falls, WA 98000, which RenoFlip could not tell to be the same home, so it was not used\./);
    assert.doesNotMatch(data.fallback!.message, /have no property/);
  }
  assert.ok(!t.asked().some((a) => a.startsWith("sales")), "and no search is paid for around the wrong house");
  // Asked again the same day in the same words (capitals and spaces aside), the address is not paid for again.
  // Written another way it is another asking, which the service may answer otherwise. A day on, it is asked again.
  const sent = t.api.calls.length;
  assert.equal((await t.ask()).fallback?.code, "not-matched");
  assert.equal((await t.ask({ address: "4821  ORCHARD LOOP RD,  Fixture Falls, WA 98000" })).fallback?.code, "not-matched");
  assert.equal(t.api.calls.length, sent);
  assert.equal((await t.ask({ address: "4821 Orchard Loop Road, Fixture Falls, WA 98000-1234" })).fallback?.code, "not-matched");
  assert.equal(t.api.calls.length, sent + 1);
  t.clock.now = new Date(TODAY.getTime() + 25 * 3_600_000);
  assert.equal((await t.ask({ asOf: "2026-11-11" })).fallback?.code, "not-matched");
  assert.equal(t.api.calls.length, sent + 2);

  // One unit of a building is not another, whatever the units are called, and a building's record is not a unit's.
  const building = [record(1, { address: "500 Main St, Unit A-1, Fixture Falls, WA 98000", propertyType: "Condo", squareFootage: 500 }), record(2, { address: "500 Main St, Unit PH1, Fixture Falls, WA 98000", propertyType: "Condo", squareFootage: 2_400 })];
  const units = connected([...building, ...soldHomes(40)]);
  // A service that answers any address in the building with the units it has there.
  const searches = units.api.fetch;
  units.api.fetch = async (url, init) => (new URL(url).searchParams.has("address") ? new Response(JSON.stringify(building), { status: 200 }) : searches(url, init));
  for (const address of ["500 Main St, Unit B-2, Fixture Falls, WA 98000", "500 Main St, Unit PH2, Fixture Falls, WA 98000", "500 Main St, Fixture Falls, WA 98000"]) {
    assert.equal((await units.ask({ address })).fallback?.code, "not-matched", address);
  }
  const penthouse = await units.ask({ address: "500 Main St #PH1, Fixture Falls, WA 98000" });
  assert.deepEqual([penthouse.demo, penthouse.recorded.sqft, penthouse.source?.record.address], [false, 2_400, "500 Main St, Unit PH1, Fixture Falls, WA 98000"]);

  // The house itself, asked for without its zip code, is found; and written with words spelled out, too.
  const own = connected([subjectRecord(), ...soldHomes(40)]);
  own.api.nearest = true;
  assert.equal((await own.ask({ address: "4821 Orchard Loop Rd, Fixture Falls, WA" })).demo, false);
  assert.equal((await own.ask({ address: "4821 Orchard Loop Road, Fixture Falls, Washington 98000" })).demo, false);
  // And as a page gives it in two pieces, with no comma between the street and a city of two words.
  assert.equal((await own.ask({ address: "4821 Orchard Loop Rd Fixture Falls, WA 98000" })).demo, false);
  // A lot on the property is not the house, even where the service answers with the house's record.
  own.api.fetch = async () => new Response(JSON.stringify([subjectRecord()]), { status: 200 });
  const lot = await own.ask({ address: "Lot 12, 4821 Orchard Loop Rd, Fixture Falls, WA 98000" });
  assert.deepEqual([lot.demo, lot.fallback?.code], [true, "not-matched"]);
});

test("another house's record kept under this house's name is never served as this house's", async () => {
  // However it got there, what is kept is checked against the address asked for like any fresh answer.
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  const neighbour = recordFrom(record(1, { address: NEXT_DOOR, squareFootage: 2_950 }))!;
  await t.store.cachePut({ key: `rentcast:property:v4:${addressKey(SUBJECT_ADDRESS)}`, provider: "rentcast", payload: JSON.stringify({ records: [neighbour], returned: 1, total: null }), fetchedAt: TODAY, expiresAt: new Date(TODAY.getTime() + 86_400_000) });
  const data = await t.ask();
  assert.deepEqual([data.demo, data.fallback?.code], [true, "not-matched"]);
  assert.equal(t.api.calls.length, 0, "it was read from what was kept: nothing was asked");
  // Once that has run out, the house is asked for and found.
  t.clock.now = new Date(TODAY.getTime() + 25 * 3_600_000);
  const later = await t.ask({ asOf: "2026-11-11" });
  assert.deepEqual([later.demo, later.recorded.sqft, later.source?.record.address], [false, 1_800, SUBJECT_ADDRESS]);
});

test("land and apartment buildings are not valued as houses", async () => {
  const t = connected([subjectRecord({ propertyType: "Land" }), ...soldHomes(40)]);
  const data = await t.ask();
  assert.deepEqual([data.demo, data.fallback?.code], [true, "not-a-house"]);
  assert.match(data.fallback!.message, /as land, and RenoFlip values single homes only/);
  assert.deepEqual(t.asked(), ["property"], "no search is paid for a property that will not be valued");

  for (const [propertyType, words] of [["Apartment", "as an apartment building"], ["Multi-Family", "as a multi-family property"]] as const) {
    const other = connected([subjectRecord({ propertyType }), ...soldHomes(40)]);
    const got = await other.ask();
    assert.deepEqual([got.demo, got.fallback?.code, other.asked()], [true, "not-a-house", ["property"]], propertyType);
    assert.ok(got.fallback!.message.includes(`${words}, and RenoFlip values single homes only`), got.fallback!.message);
  }
  // A condo, a townhouse and a manufactured home are homes, each compared with its own kind.
  for (const propertyType of ["Condo", "Townhouse", "Manufactured"]) {
    const home = connected([subjectRecord({ propertyType }), ...soldHomes(40, { made: { propertyType } }), ...soldHomes(40, { start: 200 })]);
    const got = await home.ask();
    assert.deepEqual([got.demo, got.sales.length, home.api.calls[1].params.propertyType], [false, 40, propertyType], propertyType);
  }
});

test("the sold homes kept for one house are not another house's: not at another spot, and not of another kind of home", async () => {
  // Two houses of one size, thirty miles apart, each with its own sold homes; and a condo at the first house's own spot.
  const far = "77 Far Meadow Rd, Fixture Falls, WA 98001";
  const condo = "4821 Orchard Loop Rd, Unit 2, Fixture Falls, WA 98000";
  const t = connected([
    subjectRecord(),
    ...soldHomes(40),
    record(600, { address: far, north: 30, zipCode: "98001" }),
    ...soldHomes(12, { start: 610, around: { north: 30, east: 0 }, made: { zipCode: "98001" } }),
    record(700, { address: condo, propertyType: "Condo" }),
    ...soldHomes(9, { start: 710, made: { propertyType: "Condo" } }),
  ]);
  const here = await t.ask();
  const there = await t.ask({ address: far });
  const flat = await t.ask({ address: condo });
  assert.deepEqual([here.sales.length, there.sales.length, flat.sales.length], [40, 12, 9]);
  assert.ok(there.sales.every((s) => s.submarket === "98001") && here.sales.every((s) => s.submarket === "98000"));
  // Each was asked for: one search apiece, none served from another's.
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "property", "sales 1 mi", "property", "sales 1 mi"]);
});

test("a house whose size nobody gives cannot be compared; the listing's size is enough", async () => {
  const t = connected([subjectRecord({ squareFootage: null }), ...soldHomes(40)]);
  const without = await t.ask();
  assert.deepEqual([without.demo, without.fallback?.code], [true, "no-size"]);
  const withListing = await t.ask({ overrides: { sqft: 1_820 } });
  assert.deepEqual([withListing.demo, withListing.facts.sqft, withListing.recorded.sqft], [false, 1_820, null]);
});

test("a record that leaves its zip code field out takes the zip of the address", async () => {
  const t = connected([subjectRecord({ zipCode: null }), ...soldHomes(40)]);
  const data = await t.ask();
  assert.deepEqual([data.demo, data.facts.submarket], [false, "98000"]);
});

test("the budget used up: the demo's data, and the day more open up", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)], { budget: { requests: 2 } });
  assert.equal((await t.ask()).demo, false);
  // Another house, and nothing left to ask with.
  const data = await t.ask({ address: "101 Sample St, Fixture Falls, WA 98000" });
  assert.deepEqual([data.provider, data.demo, data.fallback?.code], ["synthetic", true, "budget"]);
  assert.match(data.fallback!.message, /used up for now; more open up on December 11\./);
  assert.equal(t.api.calls.length, 2, "nothing was sent past the budget");
  assert.equal(t.store.requests.length, 2);
});

test("one person's share used up does not take real data from the next person", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40), record(900, { address: "77 Other Way, Fixture Falls, WA 98000" })], { budget: { perPerson: 2 } });
  assert.equal((await t.ask()).demo, false);
  const mine = await t.ask({ address: "77 Other Way, Fixture Falls, WA 98000" });
  assert.deepEqual([mine.demo, mine.fallback?.code], [true, "your-share"]);
  assert.match(mine.fallback!.message, /^You have used your share/);
  assert.equal((await t.ask({ address: "77 Other Way, Fixture Falls, WA 98000", userId: "bob" })).demo, false);
});

test("the service down: the demo's data, and a request that got no answer is counted as spent", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  t.api.fail = { status: 500 };
  const refused = await t.ask();
  assert.deepEqual([refused.demo, refused.fallback?.code], [true, "unavailable"]);
  assert.match(refused.fallback!.message, /did not answer just now\. Run it again in a few minutes/);
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["free"]);

  t.api.fail = { noAnswer: true };
  assert.equal((await t.ask()).fallback?.code, "unavailable");
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["free", "unknown"]);

  // A key that is refused (401, 403) is ours to fix, and the person is told that running it again will not help.
  for (const status of [401, 403]) {
    t.api.fail = { status };
    const turnedAway = await t.ask();
    assert.equal(turnedAway.fallback?.code, "refused");
    assert.match(turnedAway.fallback!.message, /turned RenoFlip away\. That is ours to fix, and running it again will not help/);
  }

  // An answer that cannot be read was billed all the same, and is not kept as if it were an answer.
  t.api.fail = { garbled: true };
  assert.equal((await t.ask()).fallback?.code, "unavailable");
  assert.equal(t.store.requests.at(-1)?.outcome.status, "billed");
  assert.equal(t.store.cache.size, 0);

  t.api.fail = null;
  assert.equal((await t.ask()).demo, false, "and when it answers again, the data is real again");
});

test("the search fails after the record was read: still the demo's, never half of each", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  t.api.fail = { status: 503, only: "sales" };
  const data = await t.ask();
  assert.deepEqual([data.provider, data.demo, data.fallback?.code, data.source], ["synthetic", true, "unavailable", undefined]);
  assert.equal(data.sales.length, 600);
});

test("at the edge of town a mile holds too few sales, so the search goes on to two and a half", async () => {
  // Two sales within a mile, twelve more between one and a quarter and two and a quarter miles out.
  const t = connected([subjectRecord(), ...soldHomes(2), ...soldHomes(12, { start: 100, fromMiles: 1.25, withinMiles: 2.25 })]);
  const data = await t.ask();
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 2.5 mi"]);
  assert.deepEqual([data.demo, data.sales.length, data.tiers.length], [false, 14, 4]);
  const s = data.source!.search;
  assert.deepEqual([s.radiusMiles, s.months, s.sampled, s.stoppedEarly], [2.5, 18, false, false]);
});

test("in the country it goes on to five miles and two years", async () => {
  // Two sales within a mile; twenty more between two and four and a half miles out, some of them over a year old.
  const t = connected([subjectRecord(), ...soldHomes(2), ...soldHomes(20, { start: 100, fromMiles: 2, withinMiles: 4.5, withinDays: 700 })]);
  const data = await t.ask();
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 2.5 mi", "sales 5 mi"]);
  assert.deepEqual([data.demo, data.sales.length, data.tiers.length], [false, 22, 5]);
  const s = data.source!.search;
  assert.deepEqual([s.radiusMiles, s.months, s.sampled, s.stoppedEarly], [5, 24, false, false]);
  // Each wider search asks for a wider band of sizes (around the size to the nearest hundred) and of time (in whole 31-day months).
  assert.deepEqual([t.api.calls[1].params.squareFootage, t.api.calls[1].params.saleDateRange], ["1200:2450", "*:372"]);
  assert.deepEqual([t.api.calls[2].params.squareFootage, t.api.calls[2].params.saleDateRange], ["1100:2500", "*:558"]);
  assert.deepEqual([t.api.calls[3].params.squareFootage, t.api.calls[3].params.saleDateRange], ["1050:2600", "*:744"]);
});

test("nothing at all has sold around the house: real data, no sales, and the analysis will say so itself", async () => {
  const t = connected([subjectRecord()]);
  const data = await t.ask();
  // The search went as far as it goes: it was not stopped early.
  assert.deepEqual([data.demo, data.sales.length, data.source?.search.found, data.source?.search.radiusMiles, data.source?.search.stoppedEarly], [false, 0, 0, 5, false]);
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 2.5 mi", "sales 5 mi"]);
  // "Nothing matched" is a 404 at RentCast, which it does not bill.
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["billed", "free", "free", "free"]);
});

test("where more sold than one request returns, the nearest are asked for again in full", async () => {
  // 700 sales within a mile. One request returns 500 of them, and not the nearest 500.
  const homes = soldHomes(700, { fromMiles: 0, withinMiles: 1 });
  const t = connected([subjectRecord(), ...homes]);
  const data = await t.ask();
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 0.77 mi"]);
  // The smaller circle came back whole, so the result may say so: everything within 0.77 miles, a part of the rest.
  assert.deepEqual([data.source?.search.sampled, data.source?.search.wholeWithinMiles, data.source?.search.stoppedEarly], [true, 0.77, false]);
  // Every sale within the smaller radius is there, though the first answer left the nearest two hundred out.
  const got = new Set(data.sales.map((s) => s.address));
  const near = homes.filter((h) => Math.hypot((Number(h.latitude) - 47.1) * 69.0, (Number(h.longitude) + 122.3) * 69.17 * Math.cos((47.1 * Math.PI) / 180)) <= 0.76);
  assert.ok(near.length > 350 && near.length < 500, `${near.length} within the smaller radius`);
  assert.deepEqual(near.filter((h) => !got.has(String(h.formattedAddress))).length, 0);
  assert.ok(data.sales.length > 500 && data.sales.length < 700);

  // Run again from what was kept: the same is known, and said.
  const again = await t.ask();
  assert.equal(t.api.calls.length, 3);
  assert.deepEqual([again.source?.search.sampled, again.source?.search.wholeWithinMiles], [true, 0.77]);
});

test("where the homes stand closest right around the house, the smaller circle is a part too, and the result does not claim the nearest", async () => {
  // 700 sales, all within half a mile: the circle worked out for an even spread over the mile (0.77) holds every one of them.
  const homes = soldHomes(700, { fromMiles: 0, withinMiles: 0.5 });
  const t = connected([subjectRecord(), ...homes]);
  const data = await t.ask();
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 0.77 mi"]);
  const s = data.source!.search;
  assert.deepEqual([data.demo, s.sampled, s.wholeWithinMiles], [false, true, null]);
  // What was read is 500 of the 700 (the same 500 twice, here), and the nearest are among those left out.
  assert.equal(s.found, 500);

  // The smaller circle could not be asked at all (the lookups ran out after the mile): a part, and no more is claimed.
  const short = connected([subjectRecord(), ...soldHomes(700, { fromMiles: 0, withinMiles: 1 })], { budget: { requests: 2 } });
  const cut = await short.ask();
  assert.deepEqual(short.asked(), ["property", "sales 1 mi"]);
  assert.deepEqual([cut.demo, cut.source?.search.sampled, cut.source?.search.wholeWithinMiles], [false, true, null]);
});

test("no run sends more than five requests, and a second run for the house sends none and stops in the same place", async () => {
  // The worst case: sales by the hundred at every step, and none of them comparable. Every step would be asked twice.
  const t = connected([subjectRecord(), ...soldHomes(700, { fromMiles: 0, withinMiles: 1 })]);
  const data = await t.ask({ overrides: NOTHING_COMPARES });
  assert.deepEqual(t.asked(), ["property", "sales 1 mi", "sales 0.77 mi", "sales 2.5 mi", "sales 1.94 mi"]);
  assert.equal(t.billed(), 1 + MAX_SEARCHES);
  // Real data all the same, said to be a part of what matched, and to have stopped before the five-mile step.
  const s = data.source!.search;
  assert.deepEqual([data.demo, s.sampled, s.stoppedEarly, s.radiusMiles, data.tiers.length], [false, true, true, 2.5, 4]);
  // What is said of the widest step asked: its smaller circle (1.94 miles) holds all 700, so nothing is known to be whole.
  assert.equal(s.wholeWithinMiles, null);

  // Run again: every question is answered from what was kept, and the run stops where the first one did.
  const again = await t.ask({ overrides: NOTHING_COMPARES });
  assert.equal(t.api.calls.length, 5, `a second run asked: ${t.asked().slice(5).join(", ")}`);
  assert.deepEqual([again.source?.search.radiusMiles, again.source?.search.stoppedEarly, again.sales.length], [2.5, true, data.sales.length]);
});

test("a search that gets no answer counts toward the five all the same", async () => {
  // Every second search (the ones asked again over a smaller radius) gets no answer.
  const t = connected([subjectRecord(), ...soldHomes(700, { fromMiles: 0, withinMiles: 1 })]);
  const real = t.api.fetch;
  t.api.fetch = async (url, init) => {
    const radius = new URL(url).searchParams.get("radius");
    if (radius && !["1", "2.5", "5"].includes(radius)) {
      t.api.calls.push({ kind: "sales", url, params: { radius }, key: null, redirect: init.redirect, cache: init.cache });
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return real(url, init);
  };
  await t.ask({ overrides: NOTHING_COMPARES });
  assert.equal(t.store.requests.length, 5, `rows: ${t.store.requests.map((r) => `${r.kind}:${r.outcome.status}`).join(", ")}`);
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["billed", "billed", "unknown", "billed", "unknown"]);
});

test("a wider search that cannot be asked leaves what the first one found, when that is something to compare with", async () => {
  // Two requests allowed: the record and the mile, which finds two sales. The wider search is refused.
  const homes = [subjectRecord(), ...soldHomes(2), ...soldHomes(20, { start: 100, fromMiles: 2, withinMiles: 4.5 })];
  const t = connected(homes, { budget: { requests: 2 } });
  const data = await t.ask();
  assert.deepEqual(t.asked(), ["property", "sales 1 mi"]);
  assert.deepEqual([data.demo, data.sales.length, data.source?.search.stoppedEarly, data.source?.search.radiusMiles, data.tiers.length], [false, 2, true, 1, 3]);

  // The same with nothing to compare among what the mile found: then the reason the search stopped is the reason
  // there are no real prices, and the person is told that, not that nothing sold for miles around.
  const none = connected(homes, { budget: { requests: 2 } });
  const stopped = await none.ask({ overrides: NOTHING_COMPARES });
  assert.deepEqual([stopped.demo, stopped.fallback?.code], [true, "budget"]);
  assert.match(stopped.fallback!.message, /used up for now/);
});

test("records with the day of a sale and no price: one search, and the person is told the area does not publish prices", async () => {
  const t = connected([subjectRecord(), ...soldHomes(30, { made: { soldFor: 0 } })]);
  const data = await t.ask();
  assert.deepEqual([data.demo, data.fallback?.code], [true, "no-prices"]);
  assert.match(data.fallback!.message, /give the dates homes sold on but not the prices \(some states do not publish them\)/);
  assert.deepEqual(t.asked(), ["property", "sales 1 mi"], "asking wider would buy more of the same");
});

test("all the asking for one house has a time limit, and past it the house gets the demo's data", async () => {
  const t = connected([subjectRecord(), ...soldHomes(40)], { deadlineMs: 2_060 });
  t.api.delayMs = 90;
  const data = await t.ask();
  assert.deepEqual([data.demo, data.fallback?.code], [true, "unavailable"]);
  assert.deepEqual(t.asked(), ["property"], "nothing more was asked once too little time was left");
});

test("real sold prices are for a valuation dated today: any other date gets the demo, said as that, and nothing is asked", async () => {
  // A record keeps a home's last sale only, so what stood on record on another day cannot be read today.
  const t = connected([subjectRecord(), ...soldHomes(40)]);
  for (const asOf of ["2026-08-01", "2026-11-08", "2026-11-12", "2027-01-01"]) {
    const data = await t.ask({ asOf });
    assert.deepEqual([data.demo, data.fallback?.code], [true, "other-date"], asOf);
    assert.equal(data.fallback!.message, `Real sold prices are read as they stand today, so a valuation dated ${asOf} cannot be built on them.`);
  }
  assert.equal(t.api.calls.length, 0);
  assert.equal(t.store.requests.length, 0);
  // A run that crosses midnight between the handler and here, or a caller a time zone away, is still "today",
  // and asks the same question as any other run that day.
  for (const [now, asOf] of [["2026-11-11T00:00:02.000Z", "2026-11-10"], ["2026-11-10T23:59:58.000Z", "2026-11-11"], ["2026-11-10T10:00:00.000Z", "2026-11-10"]]) {
    const late = connected([subjectRecord(), ...soldHomes(40)]);
    late.clock.now = new Date(now);
    assert.equal((await late.ask({ asOf })).demo, false, `${now} for ${asOf}`);
    assert.equal(late.api.calls[1].params.saleDateRange, "*:372");
  }
});

test("\"nothing sold here\" is an answer and is kept: a house in the country keeps its real data when the lookups run out", async () => {
  // Nothing within a mile; twelve sales between one and a quarter and two and a quarter miles out.
  const homes = [subjectRecord(), ...soldHomes(12, { start: 100, fromMiles: 1.25, withinMiles: 2.25 })];
  const t = connected(homes, { budget: { requests: 2 } });
  const first = await t.ask();
  assert.deepEqual([first.demo, first.sales.length, t.asked()], [false, 12, ["property", "sales 1 mi", "sales 2.5 mi"]]);
  // The mile's "nothing matched" cost nothing, and the budget of two is now used up.
  assert.deepEqual(t.store.requests.map((r) => r.outcome.status), ["billed", "free", "billed"]);
  // Run again: all three answers were kept, the empty one among them, so nothing needs the budget.
  const again = await t.ask({ userId: "bob" });
  assert.deepEqual([again.demo, again.fallback, again.sales.length, t.api.calls.length], [false, undefined, 12, 3]);
});

test("the sold homes are said to have been read when the oldest of their answers was", async () => {
  // Day one, two requests allowed: the record and the mile, which finds two sales. Three days on, the wider ring is read.
  const homes = [subjectRecord(), ...soldHomes(2), ...soldHomes(12, { start: 100, fromMiles: 1.25, withinMiles: 2.25 })];
  const store = new MemoryDataStore();
  const first = connected(homes, { store, budget: { requests: 2 } });
  const early = await first.ask();
  assert.deepEqual([early.sales.length, early.source?.search.stoppedEarly, early.source?.search.readAt], [2, true, TODAY.toISOString()]);
  const later = connected(homes, { store });
  later.clock.now = new Date(TODAY.getTime() + 3 * 86_400_000);
  const data = await later.ask({ asOf: "2026-11-13" });
  assert.deepEqual([data.sales.length, later.asked()], [14, ["sales 2.5 mi"]]);
  // Two of the fourteen were read on day one: that is the day given, not the day of the last answer.
  assert.equal(data.source?.search.readAt, TODAY.toISOString());
});

test("a house's last sale with its day and no price is a sale on record; a few priced sales are still sales where most give no price", async () => {
  const t = connected([subjectRecord({ soldDaysAgo: 400, soldFor: 0 }), ...soldHomes(40)]);
  const data = await t.ask();
  assert.deepEqual([data.demo, data.source?.record.lastSale, data.source?.record.soldOn], [false, null, "2025-10-06"]);
  const priced = await connected([subjectRecord(), ...soldHomes(40)]).ask();
  assert.deepEqual([priced.source?.record.lastSale?.price, priced.source?.record.soldOn], [365_000, null]);

  // Six priced sales within the mile, forty further out with the day and no price: the six are used, and the
  // person is not told that there are no prices.
  const mixed = connected([subjectRecord(), ...soldHomes(6), ...soldHomes(40, { start: 100, fromMiles: 1.25, withinMiles: 2.25, made: { soldFor: 0 } })]);
  const some = await mixed.ask();
  assert.deepEqual([some.demo, some.fallback, some.sales.length, some.source?.search.found, some.source?.search.usable], [false, undefined, 6, 6, 6]);
  const fewer = connected([subjectRecord(), ...soldHomes(4), ...soldHomes(40, { start: 100, fromMiles: 1.25, withinMiles: 2.25, made: { soldFor: 0 } })]);
  const four = await fewer.ask();
  assert.deepEqual([four.demo, four.fallback, four.sales.length, four.source?.search.usable], [false, undefined, 4, 4]);
  assert.equal(four.source?.search.found, 44, "the forty without a price were found, and are counted as found, not as usable");
});

test("the settings: no key, a key that cannot be one, or a budget of 0 is off; the API's address can only be https or this machine", () => {
  const KEY = "test-key-0123456789";
  assert.equal(rentcastFromEnv({}), null);
  assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: "  " }), null);
  assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: KEY, FLIP_RENTCAST_REQUESTS: "0" }), null);
  assert.deepEqual(rentcastFromEnv({ RENTCAST_API_KEY: ` ${KEY} ` }), { key: KEY, baseUrl: RENTCAST_BASE_URL, budget: DEFAULT_DATA_BUDGET });
  assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: KEY, RENTCAST_BASE_URL: "http://127.0.0.1:3419/v1/" })?.baseUrl, "http://127.0.0.1:3419/v1");
  assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: KEY, RENTCAST_BASE_URL: "https://api.example.test/v1" })?.baseUrl, "https://api.example.test/v1");
  // The key is never sent over plain http to another machine, whatever the setting says.
  for (const bad of ["http://api.example.test/v1", "http://127.0.0.1.example.test/v1", "ftp://127.0.0.1/v1", "javascript:alert(1)", ""]) {
    assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: KEY, RENTCAST_BASE_URL: bad })?.baseUrl, RENTCAST_BASE_URL, bad);
  }
  // A key pasted with a space or a line break in it is not a key: real data stays off, and the log says why without the key.
  const logged: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: "two words-of-a-key" }), null);
    assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: "first-line\nsecond-line" }), null);
    assert.equal(rentcastFromEnv({ RENTCAST_API_KEY: "short" }), null);
  } finally {
    console.error = error;
  }
  assert.equal(logged.length, 3);
  assert.ok(logged.every((line) => /RENTCAST_API_KEY is set but is not a key/.test(line) && !/words|second-line|short/.test(line)));
});
