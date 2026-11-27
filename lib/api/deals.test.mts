import { test } from "node:test";
import assert from "node:assert/strict";
import { createCheckHandler, createFindHandler, readSearch } from "./deals.ts";
import { MemoryDataStore } from "../data/budget.ts";
import { createDealFinder } from "../data/deal-finder.ts";
import { createHouseData } from "../data/house-data.ts";
import { TODAY, fakeRentcast, listing, record, soldHomes } from "../data/rentcast-fixtures.mts";

const GOOD = { zips: ["98000"], price: { min: 200_000, max: 600_000 }, targetProfit: 60_000, repair: "medium", propertyType: "Single Family" };

function rig(user: string | null = "ann", connected = true) {
  const api = fakeRentcast([...soldHomes(40), record(501, { north: 0.1 })], [listing(501, { asking: 250_000, north: 0.1 }), listing(502, { asking: 480_000, east: 0.1 })]);
  const store = new MemoryDataStore();
  const settings = () => (connected ? { key: "test-key", baseUrl: "https://api.test/v1", budget: { requests: 45, perPerson: 30, windowDays: 31 } } : null);
  const finder = createDealFinder({ rentcast: settings, store, now: () => TODAY, fetcher: api.fetch, houseData: createHouseData({ rentcast: settings, store, now: () => TODAY, fetcher: api.fetch }) });
  const deps = { userId: async () => user, finder };
  const call = async (handler: (req: Request) => Promise<Response>, body: unknown) => {
    const res = await handler(new Request("http://flip.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { api, store, find: (body: unknown) => call(createFindHandler(deps), body), check: (body: unknown) => call(createCheckHandler(deps), body) };
}

test("deals: a signed-out caller gets 401 and nothing is asked", async () => {
  const r = rig(null);
  assert.deepEqual([(await r.find(GOOD)).status, (await r.check({ ...GOOD, ids: ["x"] })).status, r.api.calls.length], [401, 401, 0]);
});

test("deals: a search that is not well formed is refused, in plain words, before anything is asked", async () => {
  const r = rig();
  const cases: [unknown, RegExp][] = [
    ["not json", /Body must be JSON/],
    [[], /Body must be a JSON object/],
    [{ ...GOOD, zips: [] }, /at least one zip code/],
    [{ ...GOOD, zips: ["9800"] }, /five digits/],
    [{ ...GOOD, zips: ["98000", "98001", "98002", "98003", "98004", "98005"] }, /at most 5 zip codes/],
    [{ ...GOOD, price: { min: 700_000, max: 600_000 } }, /lowest price is above the highest/],
    [{ ...GOOD, price: { min: "a", max: 600_000 } }, /lowest price must be a number/],
    [{ ...GOOD, targetProfit: -5 }, /profit you want must be a number/],
    [{ ...GOOD, targetProfit: 500 }, /profit you want must be a number from 1,000/],
    [{ ...GOOD, repair: "gut" }, /light, medium or heavy/],
    [{ ...GOOD, propertyType: "Land" }, /Single Family, Townhouse, Condo/],
  ];
  for (const [body, error] of cases) {
    const res = await r.find(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, error);
  }
  assert.equal(r.api.calls.length, 0);
  // The same zip code twice is one zip code; spaces around it do not matter.
  assert.deepEqual(readSearch({ ...GOOD, zips: [" 98000 ", "98000"] }).zips, ["98000"]);
});

test("deals: a search answers with the homes, the areas read, the lookups, and the word untested", async () => {
  const r = rig();
  const res = await r.find(GOOD);
  assert.equal(res.status, 200);
  assert.equal(res.body.untested, true);
  assert.deepEqual([res.body.connected, res.body.areas[0].status, res.body.homes.length, res.body.homes[0].screen.heat, res.body.homes[1].screen.heat], [true, "ok", 2, "hot", "cold"]);
  assert.deepEqual(res.body.lookups, { used: 2, of: 45, mine: 2, myShare: 30 });
  assert.deepEqual(res.body.search, { ...GOOD, price: [200_000, 600_000] });
  // Nothing in it is a verdict.
  assert.doesNotMatch(JSON.stringify(res.body), /"GO"|"verdict"/);
});

test("deals: not connected, a search says so and asks nothing", async () => {
  const r = rig("ann", false);
  const res = await r.find(GOOD);
  assert.deepEqual([res.status, res.body.connected, res.body.homes, r.api.calls.length], [200, false, [], 0]);
});

test("deals: a closer look takes the homes chosen, five at most", async () => {
  const r = rig();
  const first = await r.find(GOOD);
  const id = first.body.homes[0].listing.id;
  const res = await r.check({ ...GOOD, ids: [id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.homes.find((h: { listing: { id: string } }) => h.listing.id === id).checked.status, "ok");
  assert.match((await r.check({ ...GOOD, ids: [] })).body.error, /Choose the homes/);
  assert.match((await r.check({ ...GOOD, ids: ["a", "b", "c", "d", "e", "f"] })).body.error, /5 homes at most/);
  assert.match((await r.check({ ...GOOD, ids: [7] })).body.error, /Choose the homes/);
});

test("deals: what a search may cost is answered first, asking nothing", async () => {
  const r = rig();
  const before = await r.find({ ...GOOD, estimate: true });
  assert.equal(before.status, 200);
  assert.deepEqual([before.body.estimate.upTo, before.body.estimate.zips, before.body.homes, r.api.calls.length], [3, [{ zip: "98000", upTo: 3 }], undefined, 0]);
  await r.find(GOOD);
  const after = await r.find({ ...GOOD, estimate: true });
  assert.deepEqual([after.body.estimate.upTo, r.api.calls.length], [0, 2]);
  // Only the word true asks for an estimate.
  const real = await r.find({ ...GOOD, estimate: "yes" });
  assert.equal(real.body.estimate, undefined);
  assert.equal(real.body.untested, true);
});
