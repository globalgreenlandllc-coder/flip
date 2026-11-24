/**
 * Who may run what, how often. A full analysis costs real money (the AI
 * photo reading), so each person gets a monthly allowance and a short-window
 * rate limit, and everyone together gets a daily ceiling. Quick Numbers costs
 * nothing to run, so it only has a rate limit.
 *
 * Pure: the rules and the words. Where the runs are kept is a UsageStore
 * (prisma-store.ts in the app, a list in memory in tests).
 */

export type RunKind = "analyze" | "quick";

/**
 * started - in flight. Counts as paid for while it is recent: the AI may
 *           already have been asked. A run still "started" long after any run
 *           could be going (see STARTED_COUNTS_FOR_MINUTES) was cut off before
 *           it could say how it ended, and stops counting.
 * ok      - finished.
 * failed  - the AI answered and something went wrong after: paid for.
 * free    - ended without an answer from the AI: no photos, no price, a
 *           blocked link, an AI service that never answered. Not paid for.
 *
 * A run that is turned away by a limit leaves no row at all.
 */
export type RunStatus = "started" | "ok" | "failed" | "free";

/** A function runs for two minutes at most. After this long a "started" row is a run that died, not one in flight. */
export const STARTED_COUNTS_FOR_MINUTES = 15;

export interface UsageLimits {
  /** Full analyses per person per calendar month (UTC). */
  monthlyAnalyses: number;
  /** Analyses that reached the AI, per person per window. */
  analysesPerWindow: number;
  /** Attempts of any kind at an analysis, per person per window: each one may fetch a page and photos. */
  attemptsPerWindow: number;
  /** Quick Numbers runs per person per window. */
  quickPerWindow: number;
  windowMinutes: number;
  /** Full analyses per day (UTC), everyone together: the ceiling on one day's AI bill. */
  dailyAnalysesAll: number;
}

export const DEFAULT_LIMITS: UsageLimits = {
  monthlyAnalyses: 40,
  analysesPerWindow: 6,
  attemptsPerWindow: 30,
  quickPerWindow: 60,
  windowMinutes: 10,
  dailyAnalysesAll: 150,
};

function whole(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** The limits in force: the defaults, each replaceable by a setting on the project. */
export function limitsFromEnv(env: Record<string, string | undefined> = process.env): UsageLimits {
  return {
    monthlyAnalyses: whole(env.FLIP_MONTHLY_ANALYSES, DEFAULT_LIMITS.monthlyAnalyses),
    analysesPerWindow: whole(env.FLIP_ANALYSES_PER_10_MIN, DEFAULT_LIMITS.analysesPerWindow),
    attemptsPerWindow: whole(env.FLIP_ATTEMPTS_PER_10_MIN, DEFAULT_LIMITS.attemptsPerWindow),
    quickPerWindow: whole(env.FLIP_QUICK_PER_10_MIN, DEFAULT_LIMITS.quickPerWindow),
    windowMinutes: DEFAULT_LIMITS.windowMinutes,
    dailyAnalysesAll: whole(env.FLIP_DAILY_ANALYSES_ALL, DEFAULT_LIMITS.dailyAnalysesAll),
  };
}

/** The moments a count is taken between. */
export interface CountQuery {
  userId: string;
  kind: RunKind;
  monthStart: Date;
  windowStart: Date;
  dayStart: Date;
  /** "started" rows older than this no longer count as paid for. */
  startedSince: Date;
}

export interface RunCounts {
  /** This person's paid-for analyses this calendar month. */
  month: number;
  /** This person's paid-for analyses during the window. */
  windowPaid: number;
  /** This person's runs of the same kind during the window, however they ended. */
  windowAll: number;
  /** Everyone's paid-for analyses today. */
  dayAll: number;
}

export interface RunOutcome {
  status: RunStatus;
  photos?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  ms?: number;
}

export interface UsageStore {
  /** Record a run as started; its id. */
  start(run: { userId: string; kind: RunKind; source?: string | null; at: Date }): Promise<string>;
  /** Counts as of the query's moments, the run just started included. */
  counts(query: CountQuery): Promise<RunCounts>;
  /** This person's paid-for analyses since `monthStart`: one cheap question, for showing where the month stands. */
  monthUsed(query: Pick<CountQuery, "userId" | "monthStart" | "startedSince">): Promise<number>;
  finish(id: string, outcome: RunOutcome): Promise<void>;
  /** Take a run back off the record: it was turned away, or could not be counted. */
  discard(id: string): Promise<void>;
}

export const monthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
export const nextMonthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
export const dayStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
export const nextDayStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
const startedSince = (at: Date) => new Date(at.getTime() - STARTED_COUNTS_FOR_MINUTES * 60_000);

/** Whether a run counts as paid for as of `since` (the query's startedSince). */
export function paidFor(status: RunStatus, startedAt: Date, since: Date): boolean {
  return status === "ok" || status === "failed" || (status === "started" && startedAt >= since);
}

/** What a person is shown about their month. */
export interface UsageSummary {
  used: number;
  limit: number;
  /** ISO date (YYYY-MM-DD) the monthly count starts again. */
  resetsOn: string;
}

export type LimitReason = "monthly" | "window" | "daily";

export type Admission =
  | { ok: true; runId: string; usage: UsageSummary }
  | { ok: false; reason: LimitReason; message: string; retryAfterSeconds: number; usage: UsageSummary };

const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * Let a run in, or turn it away. The run is written down first and counted
 * second, so two requests arriving together see each other: a burst can be
 * turned away too eagerly, never let through. A run that is turned away, or
 * that cannot be counted, is taken back off the record, so neither a limit
 * nor a database hiccup ever uses up anybody's allowance.
 */
export async function admit(store: UsageStore, limits: UsageLimits, run: { userId: string; kind: RunKind; source?: string | null; at: Date }): Promise<Admission> {
  const { at } = run;
  const runId = await store.start(run);
  let counts: RunCounts;
  try {
    counts = await store.counts({
      userId: run.userId,
      kind: run.kind,
      monthStart: monthStart(at),
      windowStart: new Date(at.getTime() - limits.windowMinutes * 60_000),
      dayStart: dayStart(at),
      startedSince: startedSince(at),
    });
  } catch (err) {
    await store.discard(runId).catch(() => {});
    throw err;
  }
  const summary = (used: number): UsageSummary => ({ used: Math.min(Math.max(0, used), limits.monthlyAnalyses), limit: limits.monthlyAnalyses, resetsOn: nextMonthStart(at).toISOString().slice(0, 10) });

  let refusal: { reason: LimitReason; message: string; retryAfterSeconds: number } | null = null;
  const windowSeconds = limits.windowMinutes * 60;
  const wait = "Give it a few minutes and try again.";
  if (run.kind === "quick") {
    if (counts.windowAll > limits.quickPerWindow) refusal = { reason: "window", message: `That is a lot of runs in ${limits.windowMinutes} minutes. ${wait}`, retryAfterSeconds: windowSeconds };
  } else if (counts.month > limits.monthlyAnalyses) {
    refusal = {
      reason: "monthly",
      message: `You have used all ${limits.monthlyAnalyses} analyses for this month. The count starts again on ${longDate(nextMonthStart(at))}. Quick numbers and your saved deals still work.`,
      retryAfterSeconds: Math.ceil((nextMonthStart(at).getTime() - at.getTime()) / 1000),
    };
  } else if (counts.windowPaid > limits.analysesPerWindow) {
    refusal = { reason: "window", message: `That is ${limits.analysesPerWindow} analyses in ${limits.windowMinutes} minutes, the most one person can run that fast. ${wait}`, retryAfterSeconds: windowSeconds };
  } else if (counts.windowAll > limits.attemptsPerWindow) {
    refusal = { reason: "window", message: `That is a lot of tries in ${limits.windowMinutes} minutes. ${wait}`, retryAfterSeconds: windowSeconds };
  } else if (counts.dayAll > limits.dailyAnalysesAll) {
    refusal = {
      reason: "daily",
      message: "flip has reached today's limit on analyses for everyone in the beta. It opens again tomorrow. Quick numbers and your saved deals still work.",
      retryAfterSeconds: Math.ceil((nextDayStart(at).getTime() - at.getTime()) / 1000),
    };
  }

  if (!refusal) return { ok: true, runId, usage: summary(counts.month) };
  // If it cannot be taken back it stays "started", and stops counting by itself (STARTED_COUNTS_FOR_MINUTES).
  await store.discard(runId).catch(() => {});
  // The count above included this run; turned away, it is not one of theirs.
  return { ok: false, ...refusal, usage: summary(counts.month - (run.kind === "analyze" ? 1 : 0)) };
}

/** A person's month so far, without starting a run. */
export async function usageSummary(store: UsageStore, limits: UsageLimits, userId: string, at: Date): Promise<UsageSummary> {
  const used = await store.monthUsed({ userId, monthStart: monthStart(at), startedSince: startedSince(at) });
  return { used: Math.min(used, limits.monthlyAnalyses), limit: limits.monthlyAnalyses, resetsOn: nextMonthStart(at).toISOString().slice(0, 10) };
}

/** The store as a plain list, for tests and scripts. Same counting rules as the database store. */
export class MemoryUsageStore implements UsageStore {
  runs: { id: string; userId: string; kind: RunKind; source: string | null; at: Date; outcome: RunOutcome }[] = [];
  private made = 0;

  async start(run: { userId: string; kind: RunKind; source?: string | null; at: Date }): Promise<string> {
    const id = `run_${++this.made}`;
    this.runs.push({ id, userId: run.userId, kind: run.kind, source: run.source ?? null, at: run.at, outcome: { status: "started" } });
    return id;
  }

  async counts(q: CountQuery): Promise<RunCounts> {
    const paid = (r: { at: Date; outcome: RunOutcome }) => paidFor(r.outcome.status, r.at, q.startedSince);
    const analyses = this.runs.filter((r) => r.kind === "analyze");
    const mine = this.runs.filter((r) => r.userId === q.userId && r.kind === q.kind && r.at >= q.windowStart);
    return {
      month: analyses.filter((r) => r.userId === q.userId && r.at >= q.monthStart && paid(r)).length,
      windowPaid: mine.filter(paid).length,
      windowAll: mine.length,
      dayAll: analyses.filter((r) => r.at >= q.dayStart && paid(r)).length,
    };
  }

  async monthUsed(q: Pick<CountQuery, "userId" | "monthStart" | "startedSince">): Promise<number> {
    return this.runs.filter((r) => r.kind === "analyze" && r.userId === q.userId && r.at >= q.monthStart && paidFor(r.outcome.status, r.at, q.startedSince)).length;
  }

  async finish(id: string, outcome: RunOutcome): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (run) run.outcome = outcome;
  }

  async discard(id: string): Promise<void> {
    this.runs = this.runs.filter((r) => r.id !== id);
  }
}
