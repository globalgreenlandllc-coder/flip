import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS, STARTED_COUNTS_FOR_MINUTES, admit, dayStart, monthStart, usageSummary, type UsageStore } from "./limits.ts";

/**
 * The same counting rules, against a real Postgres. Opt-in: it writes rows, so
 * it runs only when FLIP_TEST_DATABASE_URL names a database on this machine
 * that already has the migrations applied:
 *
 *   FLIP_TEST_DATABASE_URL=postgresql://flip@127.0.0.1:54329/flip_stand npm test
 */
const url = process.env.FLIP_TEST_DATABASE_URL;
const local = url ? ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname) : false;

test("the database store counts the way the rules say", { skip: !url ? "FLIP_TEST_DATABASE_URL is not set" : !local ? "FLIP_TEST_DATABASE_URL must be a database on this machine" : false }, async () => {
  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_UNPOOLED = url;
  const { prismaUsageStore: store } = (await import("./prisma-store.ts")) as { prismaUsageStore: UsageStore };
  const { db } = await import("../db.ts");
  try {
    const who = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const other = `${who}_other`;
    const at = new Date();
    const limits = { ...DEFAULT_LIMITS, monthlyAnalyses: 3, analysesPerWindow: 99, quickPerWindow: 2, dailyAnalysesAll: 1_000_000 };
    const query = (userId: string, kind: "analyze" | "quick") => ({ userId, kind, monthStart: monthStart(at), windowStart: new Date(at.getTime() - 600_000), dayStart: dayStart(at), startedSince: new Date(at.getTime() - STARTED_COUNTS_FOR_MINUTES * 60_000) });
    const before = await store.counts(query(who, "analyze"));
    assert.equal(before.month, 0);

    // One finished, one that never reached the AI, one whose answer was unusable, one in flight.
    const finished = await admit(store, limits, { userId: who, kind: "analyze", source: "zillow.com", at });
    assert.equal(finished.ok, true);
    if (finished.ok) await store.finish(finished.runId, { status: "ok", photos: 12, model: "claude-test", inputTokens: 21_000, outputTokens: 1_800, ms: 41_234.6 });
    const free = await admit(store, limits, { userId: who, kind: "analyze", at });
    if (free.ok) await store.finish(free.runId, { status: "free", ms: 300 });
    const failed = await admit(store, limits, { userId: who, kind: "analyze", at });
    if (failed.ok) await store.finish(failed.runId, { status: "failed", photos: 4 });
    const inFlight = await admit(store, limits, { userId: who, kind: "analyze", at });
    assert.equal(inFlight.ok, true);
    assert.equal(inFlight.usage.used, 3);

    // The month is used up: three paid-for runs (ok, failed, started); the free one did not count.
    const over = await admit(store, limits, { userId: who, kind: "analyze", at });
    assert.equal(over.ok, false);
    assert.equal(!over.ok && over.reason, "monthly");
    assert.deepEqual(await usageSummary(store, limits, who, at), { used: 3, limit: 3, resetsOn: over.usage.resetsOn });

    const after = await store.counts(query(who, "analyze"));
    assert.equal(after.month, 3);
    // In the window: ok + free + failed + started, of which three are paid for. The turned-away one left no row.
    assert.equal(after.windowAll, 4);
    assert.equal(after.windowPaid, 3);
    // Everyone's day went up by exactly the paid-for ones.
    assert.equal(after.dayAll - before.dayAll, 3);
    assert.equal(await db.usageRun.count({ where: { userId: who } }), 4);

    // The run still "started" stops counting once no run could still be going.
    const muchLater = new Date(at.getTime() + (STARTED_COUNTS_FOR_MINUTES + 1) * 60_000);
    assert.equal((await usageSummary(store, limits, who, muchLater)).used, 2);

    // What was written down for the finished run.
    const row = await db.usageRun.findFirstOrThrow({ where: { userId: who, status: "ok" } });
    assert.deepEqual(
      { kind: row.kind, source: row.source, photos: row.photos, model: row.model, inputTokens: row.inputTokens, outputTokens: row.outputTokens, ms: row.ms },
      { kind: "analyze", source: "zillow.com", photos: 12, model: "claude-test", inputTokens: 21_000, outputTokens: 1_800, ms: 41_235 },
    );

    // Another person is untouched, and Quick Numbers keeps its own count.
    assert.equal((await usageSummary(store, limits, other, at)).used, 0);
    assert.equal((await admit(store, limits, { userId: who, kind: "quick", at })).ok, true);
    assert.equal((await admit(store, limits, { userId: who, kind: "quick", at })).ok, true);
    const quick = await admit(store, limits, { userId: who, kind: "quick", at });
    assert.equal(!quick.ok && quick.reason, "window");
    assert.equal((await store.counts(query(who, "analyze"))).month, 3);

    await db.usageRun.deleteMany({ where: { userId: { in: [who, other] } } });
  } finally {
    await db.$disconnect();
  }
});
