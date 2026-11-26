import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetExhausted, DEFAULT_DATA_BUDGET, MemoryDataStore, budgetUsed, dataBudgetFromEnv, reserve, type DataBudget, type DataStore } from "./budget.ts";

const AT = new Date("2026-11-10T10:00:00.000Z");
const days = (n: number) => new Date(AT.getTime() + n * 86_400_000);
const BUDGET: DataBudget = { requests: 3, perPerson: 2, windowDays: 31 };
const ask = (store: DataStore, userId: string | null = null, at = AT, budget = BUDGET) => reserve(store, budget, { provider: "rentcast", kind: "property", userId, at });
const refused = (scope: "all" | "person") => (err: unknown) => err instanceof BudgetExhausted && err.scope === scope;

test("the budget lets its number of requests through and refuses the next, which leaves no trace", async () => {
  const store = new MemoryDataStore();
  for (let i = 0; i < 3; i++) await store.finish(await ask(store), { status: "billed", httpStatus: 200 });
  await assert.rejects(() => ask(store), refused("all"));
  assert.equal(store.requests.length, 3, "the refused request is not on the record");
  assert.deepEqual(await budgetUsed(store, BUDGET, "rentcast", AT), { used: 3, of: 3 });
});

test("a refusal says when one more opens up: the day the oldest request leaves the 31 days", async () => {
  const store = new MemoryDataStore();
  await store.finish(await ask(store, null, days(-20)), { status: "billed" });
  await store.finish(await ask(store, null, days(-5)), { status: "billed" });
  await store.finish(await ask(store, null, days(-1)), { status: "billed" });
  await assert.rejects(() => ask(store), (err) => err instanceof BudgetExhausted && err.opensAt.toISOString() === days(11).toISOString());
  // Eleven days on, the oldest has left the window and one goes through.
  await ask(store, null, days(11.01));
});

test("what RentCast does not bill does not count; what it may have billed does", async () => {
  const store = new MemoryDataStore();
  // Three answered 404 (an address that is not on record): free.
  for (let i = 0; i < 3; i++) await store.finish(await ask(store), { status: "free", httpStatus: 404 });
  // One that timed out, one never marked as finished (the function died), one answered: all three count.
  await store.finish(await ask(store), { status: "unknown" });
  await ask(store);
  await store.finish(await ask(store), { status: "billed", httpStatus: 200 });
  await assert.rejects(() => ask(store), refused("all"));
});

test("one person cannot use up what everyone's results depend on", async () => {
  const store = new MemoryDataStore();
  await store.finish(await ask(store, "ann"), { status: "billed" });
  await store.finish(await ask(store, "ann"), { status: "billed" });
  await assert.rejects(() => ask(store, "ann"), refused("person"));
  // The third is still there for somebody else, and a script (nobody) has no share to run out of.
  await store.finish(await ask(store, "bob"), { status: "billed" });
  await assert.rejects(() => ask(store, "bob"), refused("all"));
  await assert.rejects(() => ask(store, null), refused("all"));
});

test("a budget of any size holds in every stretch of 31 days, whatever day a billing month starts on", async () => {
  const store = new MemoryDataStore();
  let sent = 0;
  // Ask four times a day for a hundred days.
  const when: Date[] = [];
  for (let hour = 0; hour < 100 * 24; hour += 6) {
    const at = new Date(AT.getTime() + hour * 3_600_000);
    try {
      await store.finish(await ask(store, null, at), { status: "billed" });
      when.push(at);
      sent++;
    } catch (err) {
      assert.ok(err instanceof BudgetExhausted);
    }
  }
  assert.ok(sent >= 9, `only ${sent} were let through in a hundred days`);
  for (const start of when) {
    const inWindow = when.filter((at) => at >= start && at.getTime() < start.getTime() + 31 * 86_400_000).length;
    assert.ok(inWindow <= BUDGET.requests, `${inWindow} requests in the 31 days from ${start.toISOString()}`);
  }
});

test("requests that arrive together see each other: a burst never gets past the budget", async () => {
  // A store that answers slowly, so every request is written down before any is counted.
  class Slow extends MemoryDataStore {
    async counted(q: Parameters<MemoryDataStore["counted"]>[0]) {
      await new Promise((r) => setTimeout(r, 5));
      return super.counted(q);
    }
  }
  const store = new Slow();
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => ask(store)));
  const through = results.filter((r) => r.status === "fulfilled").length;
  assert.ok(through <= BUDGET.requests, `${through} got through a budget of ${BUDGET.requests}`);
  assert.equal(store.requests.length, through);
});

test("no count, no request: when the count cannot be taken the request is taken back and nothing is sent", async () => {
  class Broken extends MemoryDataStore {
    async counted(): Promise<never> {
      throw new Error("db down");
    }
  }
  const store = new Broken();
  await assert.rejects(() => ask(store), /db down/);
  assert.equal(store.requests.length, 0);
});

test("the budget's settings: defaults, a number from the project, and 0 for off", () => {
  assert.deepEqual(dataBudgetFromEnv({}), DEFAULT_DATA_BUDGET);
  assert.deepEqual(dataBudgetFromEnv({ FLIP_RENTCAST_REQUESTS: "950", FLIP_RENTCAST_PER_PERSON: "40" }), { requests: 950, perPerson: 40, windowDays: 31 });
  assert.equal(dataBudgetFromEnv({ FLIP_RENTCAST_REQUESTS: "0" }).requests, 0);
  // A setting that is not a whole number is not a budget: the default stands, which is the free plan's.
  assert.equal(dataBudgetFromEnv({ FLIP_RENTCAST_REQUESTS: "lots" }).requests, DEFAULT_DATA_BUDGET.requests);
  assert.equal(dataBudgetFromEnv({ FLIP_RENTCAST_REQUESTS: "-1" }).requests, DEFAULT_DATA_BUDGET.requests);
  assert.ok(DEFAULT_DATA_BUDGET.requests < 50, "the default stays under the free plan's 50 a month");
});

test("a kept answer is given back until it expires, and not after", async () => {
  const store = new MemoryDataStore();
  await store.cachePut({ key: "k", provider: "rentcast", payload: "{}", fetchedAt: AT, expiresAt: days(7) });
  assert.deepEqual(await store.cacheGet("k", days(6.9)), { payload: "{}", fetchedAt: AT });
  assert.equal(await store.cacheGet("k", days(7)), null);
  assert.equal(await store.cacheGet("other", AT), null);
});
