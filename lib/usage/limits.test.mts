import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS, MemoryUsageStore, STARTED_COUNTS_FOR_MINUTES, admit, dayStart, limitsFromEnv, monthStart, nextMonthStart, usageSummary, type UsageLimits } from "./limits.ts";

const at = (iso: string) => new Date(iso);
const limits = (over: Partial<UsageLimits> = {}): UsageLimits => ({ ...DEFAULT_LIMITS, ...over });

test("limits come from the project's settings, and a bad setting falls back to the default", () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  const set = limitsFromEnv({ FLIP_MONTHLY_ANALYSES: "12", FLIP_ANALYSES_PER_10_MIN: "3", FLIP_ATTEMPTS_PER_10_MIN: "9", FLIP_QUICK_PER_10_MIN: "20", FLIP_DAILY_ANALYSES_ALL: "0" });
  assert.equal(set.monthlyAnalyses, 12);
  assert.equal(set.analysesPerWindow, 3);
  assert.equal(set.attemptsPerWindow, 9);
  assert.equal(set.quickPerWindow, 20);
  // 0 is a real setting: it turns the thing off.
  assert.equal(set.dailyAnalysesAll, 0);
  for (const bad of ["", "  ", "abc", "-5", "2.5", "1e400"]) assert.equal(limitsFromEnv({ FLIP_MONTHLY_ANALYSES: bad }).monthlyAnalyses, DEFAULT_LIMITS.monthlyAnalyses, JSON.stringify(bad));
});

test("the month and the day are calendar ones, in UTC", () => {
  const late = at("2026-11-30T23:59:59.000Z");
  assert.equal(monthStart(late).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(nextMonthStart(late).toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(nextMonthStart(at("2026-12-15T10:00:00.000Z")).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(dayStart(late).toISOString(), "2026-11-30T00:00:00.000Z");
});

test("a person gets their monthly allowance and then is told when it starts again", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ monthlyAnalyses: 2, analysesPerWindow: 99 });
  const first = await admit(store, l, { userId: "ann", kind: "analyze", at: at("2026-11-10T10:00:00Z") });
  if (first.ok) await store.finish(first.runId, { status: "ok" });
  const second = await admit(store, l, { userId: "ann", kind: "analyze", at: at("2026-11-11T10:00:00Z") });
  if (second.ok) await store.finish(second.runId, { status: "ok" });
  assert.equal(first.ok && second.ok, true);
  assert.deepEqual(second.usage, { used: 2, limit: 2, resetsOn: "2026-12-01" });

  const third = await admit(store, l, { userId: "ann", kind: "analyze", at: at("2026-11-12T10:00:00Z") });
  assert.equal(third.ok, false);
  assert.equal(!third.ok && third.reason, "monthly");
  assert.match(!third.ok ? third.message : "", /all 2 analyses for this month.*December 1/);
  assert.equal(third.usage.used, 2);
  // Turned away, it left nothing behind.
  assert.equal(store.runs.length, 2);

  // Someone else is not affected, and neither is next month.
  assert.equal((await admit(store, l, { userId: "bob", kind: "analyze", at: at("2026-11-12T10:00:00Z") })).ok, true);
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: at("2026-12-01T00:00:01Z") })).ok, true);
});

test("only runs the AI answered count against the month", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ monthlyAnalyses: 2, analysesPerWindow: 99 });
  const when = at("2026-11-10T10:00:00Z");
  for (const status of ["free", "free", "free", "failed"] as const) {
    const gate = await admit(store, l, { userId: "ann", kind: "analyze", at: when });
    assert.equal(gate.ok, true, status);
    if (gate.ok) await store.finish(gate.runId, { status });
  }
  // Three attempts the AI never answered and one it did: one used.
  assert.equal((await usageSummary(store, l, "ann", when)).used, 1);
});

test("a run that never said how it ended counts while it could still be going, and not after", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ monthlyAnalyses: 5 });
  const t0 = at("2026-11-10T10:00:00Z");
  // Admitted, and then the function died: the row stays "started".
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: t0 })).ok, true);
  assert.equal((await usageSummary(store, l, "ann", new Date(t0.getTime() + 60_000))).used, 1);
  const later = new Date(t0.getTime() + (STARTED_COUNTS_FOR_MINUTES + 1) * 60_000);
  assert.equal((await usageSummary(store, l, "ann", later)).used, 0);
  // The same for everyone's daily ceiling.
  const tight = limits({ dailyAnalysesAll: 1 });
  assert.equal((await admit(store, tight, { userId: "bob", kind: "analyze", at: later })).ok, true);
});

test("when the count cannot be taken, the run is taken back and nobody's month is touched", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ monthlyAnalyses: 5 });
  const when = at("2026-11-10T10:00:00Z");
  const counts = store.counts.bind(store);
  store.counts = async () => {
    throw new Error("database hiccup");
  };
  for (let i = 0; i < 8; i++) await assert.rejects(admit(store, l, { userId: "ann", kind: "analyze", at: when }), /database hiccup/);
  store.counts = counts;
  assert.equal(store.runs.length, 0);
  // Eight failed tries later, the allowance is whole.
  const gate = await admit(store, l, { userId: "ann", kind: "analyze", at: when });
  assert.equal(gate.ok, true);
  assert.equal(gate.usage.used, 1);
});

test("the short window limits how fast one person's analyses reach the AI, and lets them back in after", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ analysesPerWindow: 2, windowMinutes: 10 });
  const t0 = at("2026-11-10T10:00:00Z").getTime();
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0) })).ok, true);
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0 + 60_000) })).ok, true);
  const fast = await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0 + 120_000) });
  assert.equal(!fast.ok && fast.reason, "window");
  assert.equal(!fast.ok && fast.retryAfterSeconds, 600);
  assert.match(!fast.ok ? fast.message : "", /2 analyses in 10 minutes/);
  // The month reads what they really used, not the attempt that was turned away.
  assert.equal(fast.usage.used, 2);
  // A turned-away attempt does not extend the wait.
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0 + 10 * 60_000 + 1_000) })).ok, true);
});

test("tries that never reach the AI do not use up the analysis window; they have a wider one of their own", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ analysesPerWindow: 2, attemptsPerWindow: 5 });
  const t0 = at("2026-11-10T10:00:00Z").getTime();
  // Four pasted links that turned out blocked, a minute apart.
  for (let i = 0; i < 4; i++) {
    const gate = await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0 + i * 60_000) });
    assert.equal(gate.ok, true, `blocked try ${i + 1}`);
    if (gate.ok) await store.finish(gate.runId, { status: "free" });
  }
  // The real analysis after them still goes through.
  const real = await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0 + 4 * 60_000) });
  assert.equal(real.ok, true);
  if (real.ok) await store.finish(real.runId, { status: "ok" });
  // But tries are not endless either, and the words say tries, not analyses.
  const sixth = await admit(store, l, { userId: "ann", kind: "analyze", at: new Date(t0 + 5 * 60_000) });
  assert.equal(!sixth.ok && sixth.reason, "window");
  assert.match(!sixth.ok ? sixth.message : "", /a lot of tries in 10 minutes/);
  assert.equal(sixth.usage.used, 1);
});

test("everyone together cannot pass the daily ceiling", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ dailyAnalysesAll: 2 });
  const when = at("2026-11-10T10:00:00Z");
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: when })).ok, true);
  assert.equal((await admit(store, l, { userId: "bob", kind: "analyze", at: when })).ok, true);
  const cy = await admit(store, l, { userId: "cy", kind: "analyze", at: when });
  assert.equal(!cy.ok && cy.reason, "daily");
  assert.equal((await admit(store, l, { userId: "cy", kind: "analyze", at: at("2026-11-11T00:00:01Z") })).ok, true);
});

test("a burst of requests at once is never let through past the limit", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ monthlyAnalyses: 3, analysesPerWindow: 99, attemptsPerWindow: 99 });
  const when = at("2026-11-10T10:00:00Z");
  const gates = await Promise.all(Array.from({ length: 10 }, () => admit(store, l, { userId: "ann", kind: "analyze", at: when })));
  assert.ok(gates.filter((g) => g.ok).length <= 3);
  assert.ok((await usageSummary(store, l, "ann", when)).used <= 3);
});

test("Quick Numbers has a rate limit of its own and never touches the monthly allowance", async () => {
  const store = new MemoryUsageStore();
  const l = limits({ quickPerWindow: 2, monthlyAnalyses: 1 });
  const when = at("2026-11-10T10:00:00Z");
  assert.equal((await admit(store, l, { userId: "ann", kind: "quick", at: when })).ok, true);
  assert.equal((await admit(store, l, { userId: "ann", kind: "quick", at: when })).ok, true);
  const third = await admit(store, l, { userId: "ann", kind: "quick", at: when });
  assert.equal(!third.ok && third.reason, "window");
  assert.equal((await usageSummary(store, l, "ann", when)).used, 0);
  // ...and the quick runs do not eat the analysis window either.
  assert.equal((await admit(store, l, { userId: "ann", kind: "analyze", at: when })).ok, true);
});

test("a limit of zero is an off switch", async () => {
  const store = new MemoryUsageStore();
  const gate = await admit(store, limits({ monthlyAnalyses: 0 }), { userId: "ann", kind: "analyze", at: at("2026-11-10T10:00:00Z") });
  assert.equal(gate.ok, false);
  assert.equal(store.runs.length, 0);
});
