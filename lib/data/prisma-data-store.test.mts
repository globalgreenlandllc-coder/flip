import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetExhausted, budgetUsed, reserve, type DataBudget, type DataStore } from "./budget.ts";

/**
 * The request budget and the kept answers, against a real Postgres. Opt-in:
 * it writes rows, so it runs only when FLIP_TEST_DATABASE_URL names a
 * database on this machine that already has the migrations applied:
 *
 *   FLIP_TEST_DATABASE_URL=postgresql://flip@127.0.0.1:54329/flip_stand npm test
 */
const url = process.env.FLIP_TEST_DATABASE_URL;
const local = url ? ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname) : false;

test("the database store keeps the request budget and the answers the way the rules say", { skip: !url ? "FLIP_TEST_DATABASE_URL is not set" : !local ? "FLIP_TEST_DATABASE_URL must be a database on this machine" : false }, async () => {
  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_UNPOOLED = url;
  const { prismaDataStore: store } = (await import("./prisma-data-store.ts")) as { prismaDataStore: DataStore };
  const { db } = await import("../db.ts");
  // A provider of this test's own, so nothing else in the database is counted or touched.
  const provider = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const at = new Date();
    const budget: DataBudget = { requests: 4, perPerson: 2, windowDays: 31 };
    const ask = (userId: string | null, when = at) => reserve(store, budget, { provider, kind: "property", userId, at: when });

    // Billed, free (a 404), no answer, and one still in flight.
    await store.finish(await ask("ann"), { status: "billed", httpStatus: 200, results: 1, ms: 812.4 });
    await store.finish(await ask("ann"), { status: "free", httpStatus: 404, results: 0, ms: 90 });
    await store.finish(await ask("ann"), { status: "unknown" });
    // Ann's share of two is used (billed + unknown; the 404 was free).
    await assert.rejects(() => ask("ann"), (err) => err instanceof BudgetExhausted && err.scope === "person");
    await ask("bob");
    await store.finish(await ask(null), { status: "billed", httpStatus: 200, results: 500 });
    assert.deepEqual(await budgetUsed(store, budget, provider, at), { used: 4, of: 4 });
    // Used up for everyone, and the refusals left no rows behind.
    await assert.rejects(() => ask("cat"), (err) => err instanceof BudgetExhausted && err.scope === "all" && Math.abs(err.opensAt.getTime() - (at.getTime() + 31 * 86_400_000)) < 1_000);
    assert.equal(await db.dataRequest.count({ where: { provider } }), 5);

    // A burst of requests arriving together never gets past the budget.
    const fresh = `${provider}_burst`;
    const burst = await Promise.allSettled(Array.from({ length: 10 }, () => reserve(store, budget, { provider: fresh, kind: "sales", userId: null, at })));
    const through = burst.filter((b) => b.status === "fulfilled").length;
    assert.ok(through <= budget.requests, `${through} got through a budget of ${budget.requests}`);
    assert.equal(await db.dataRequest.count({ where: { provider: fresh } }), through);

    // What was written down for the first request.
    const row = await db.dataRequest.findFirstOrThrow({ where: { provider, status: "billed", userId: "ann" } });
    assert.deepEqual({ kind: row.kind, httpStatus: row.httpStatus, results: row.results, ms: row.ms }, { kind: "property", httpStatus: 200, results: 1, ms: 812 });

    // Thirty-two days on, all of it has left the window.
    assert.deepEqual(await budgetUsed(store, budget, provider, new Date(at.getTime() + 32 * 86_400_000)), { used: 0, of: 4 });

    // Kept answers: given back until they expire, replaced when kept again, swept once stale.
    const key = `${provider}:answer`;
    const week = new Date(at.getTime() + 7 * 86_400_000);
    await store.cachePut({ key, provider, payload: '{"records":[]}', fetchedAt: at, expiresAt: week });
    assert.deepEqual(await store.cacheGet(key, at), { payload: '{"records":[]}', fetchedAt: at });
    await store.cachePut({ key, provider, payload: '{"records":[1]}', fetchedAt: at, expiresAt: week });
    assert.equal((await store.cacheGet(key, at))?.payload, '{"records":[1]}');
    assert.equal(await store.cacheGet(key, week), null);
    assert.equal(await store.cacheGet(`${provider}:nothing`, at), null);
    // Keeping another answer after the first has expired sweeps the first away.
    const later = new Date(week.getTime() + 1_000);
    await store.cachePut({ key: `${key}:2`, provider, payload: "{}", fetchedAt: later, expiresAt: new Date(later.getTime() + 1_000) });
    assert.equal(await db.dataCache.count({ where: { key } }), 0);
  } finally {
    await db.dataRequest.deleteMany({ where: { provider: { startsWith: provider } } });
    await db.dataCache.deleteMany({ where: { provider } });
    await db.$disconnect();
  }
});
