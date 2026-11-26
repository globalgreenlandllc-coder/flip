/**
 * What flip may spend on a paid data provider, and the record of what it did
 * spend.
 *
 * RentCast has no hard cap: past the plan's monthly number every request is
 * charged by itself (20 cents each on the free plan), and its month runs from
 * the day the plan was opened, not from the 1st. So flip counts for itself,
 * over any 31 days in a row, which no billing month is longer than: a budget
 * kept over that window is kept in every billing month, whatever day it
 * starts on.
 *
 * Every request is written down before it is sent and counted after, so two
 * that arrive together see each other: a burst can be refused too eagerly,
 * never let past the budget. A request counts unless RentCast answered it
 * with something other than 200 (which it does not bill). One that got no
 * answer at all, or was never marked as finished, counts: it may have been
 * billed.
 *
 * Each person also has a share, so that one account cannot use up what
 * everyone's results depend on.
 *
 * Pure: the rules and the words. Where the rows are kept is a DataStore
 * (prisma-data-store.ts in the app, MemoryDataStore in tests and scripts).
 */

export interface DataBudget {
  /** Requests in any `windowDays` in a row, everyone together. 0 switches the provider off. */
  requests: number;
  /** Of those, the most one person may cause. */
  perPerson: number;
  windowDays: number;
}

/**
 * The free plan gives 50 a month. Ten are left for what this count does not
 * see: a request made by hand (`npm run rentcast:check` keeps a count of its
 * own for one run, and nothing of it reaches this one), or another copy of
 * the app run with the same key and another database. The plan's month is
 * one, whoever asks.
 */
export const DEFAULT_DATA_BUDGET: DataBudget = { requests: 40, perPerson: 30, windowDays: 31 };

function whole(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** The budget in force: the defaults, each replaceable by a setting on the project. */
export function dataBudgetFromEnv(env: Record<string, string | undefined> = process.env): DataBudget {
  return {
    requests: whole(env.FLIP_RENTCAST_REQUESTS, DEFAULT_DATA_BUDGET.requests),
    perPerson: whole(env.FLIP_RENTCAST_PER_PERSON, DEFAULT_DATA_BUDGET.perPerson),
    windowDays: DEFAULT_DATA_BUDGET.windowDays,
  };
}

/**
 * started - written down, about to be sent. Counts.
 * billed  - answered 200. Counts.
 * unknown - no answer came back. Counts: it may have been billed.
 * free    - answered with another status, which RentCast does not bill. Does not count.
 */
export type RequestStatus = "started" | "billed" | "unknown" | "free";

export const countsAgainstBudget = (status: RequestStatus) => status !== "free";

export interface RequestOutcome {
  status: Exclude<RequestStatus, "started">;
  httpStatus?: number;
  /** Records in the answer. */
  results?: number;
  ms?: number;
}

export interface DataRequestRow {
  provider: string;
  /** "property": one address. "sales": the sold homes around a point. */
  kind: string;
  /** Who caused it. Null for a script. */
  userId: string | null;
  at: Date;
}

export interface BudgetCounts {
  /** Requests that count, everyone's, since the window began. */
  all: number;
  /** This person's among them. */
  mine: number;
  /** When the oldest of each was made: the day it leaves the window is the day one more opens up. */
  oldestAt: Date | null;
  myOldestAt: Date | null;
}

export interface DataStore {
  /** Write a request down as about to be sent; its id. */
  start(row: DataRequestRow): Promise<string>;
  /** What counts against the budget since `since`, the request just started included. */
  counted(query: { provider: string; since: Date; userId: string | null }): Promise<BudgetCounts>;
  finish(id: string, outcome: RequestOutcome): Promise<void>;
  /** Take a request back off the record: it was never sent (the budget refused it, or the run it was for had been given up on by the time it was counted). */
  discard(id: string): Promise<void>;
  /** An answer kept from before, if it has not expired. */
  cacheGet(key: string, at: Date): Promise<{ payload: string; fetchedAt: Date } | null>;
  cachePut(entry: { key: string; provider: string; payload: string; fetchedAt: Date; expiresAt: Date }): Promise<void>;
}

/** The budget does not allow one more request. */
export class BudgetExhausted extends Error {
  constructor(
    /** "all": the provider's budget is used up. "person": this person's share of it is. */
    readonly scope: "all" | "person",
    /** When one more request opens up. */
    readonly opensAt: Date,
  ) {
    super(scope === "all" ? "The data budget is used up." : "This person's share of the data budget is used up.");
    this.name = "BudgetExhausted";
  }
}

const DAY_MS = 86_400_000;

/**
 * Let one request go, or refuse it. Its id is what `store.finish` is told
 * the outcome under. Throws BudgetExhausted when the budget, or this
 * person's share of it, has no room; whatever the store throws when the
 * count cannot be taken (no count, no request).
 */
export async function reserve(store: DataStore, budget: DataBudget, row: DataRequestRow): Promise<string> {
  const since = new Date(row.at.getTime() - budget.windowDays * DAY_MS);
  const id = await store.start(row);
  let counts: BudgetCounts;
  try {
    counts = await store.counted({ provider: row.provider, since, userId: row.userId });
  } catch (err) {
    await store.discard(id).catch(() => {});
    throw err;
  }
  const opens = (oldest: Date | null) => new Date((oldest ?? row.at).getTime() + budget.windowDays * DAY_MS);
  const refused = counts.all > budget.requests ? new BudgetExhausted("all", opens(counts.oldestAt)) : row.userId !== null && counts.mine > budget.perPerson ? new BudgetExhausted("person", opens(counts.myOldestAt)) : null;
  if (!refused) return id;
  // If it cannot be taken back it stays "started" and goes on counting: the safe side of a budget.
  await store.discard(id).catch(() => {});
  throw refused;
}

/** How the budget stands, without asking for anything. */
export async function budgetUsed(store: DataStore, budget: DataBudget, provider: string, at: Date): Promise<{ used: number; of: number }> {
  const counts = await store.counted({ provider, since: new Date(at.getTime() - budget.windowDays * DAY_MS), userId: null });
  return { used: counts.all, of: budget.requests };
}

/** The store as plain lists, for tests and scripts. Same counting rules as the database store. */
export class MemoryDataStore implements DataStore {
  requests: (DataRequestRow & { id: string; outcome: RequestOutcome | { status: "started" } })[] = [];
  cache = new Map<string, { provider: string; payload: string; fetchedAt: Date; expiresAt: Date }>();
  private made = 0;

  async start(row: DataRequestRow): Promise<string> {
    const id = `req_${++this.made}`;
    this.requests.push({ ...row, id, outcome: { status: "started" } });
    return id;
  }

  async counted(q: { provider: string; since: Date; userId: string | null }): Promise<BudgetCounts> {
    const counting = this.requests.filter((r) => r.provider === q.provider && r.at >= q.since && countsAgainstBudget(r.outcome.status));
    const mine = q.userId === null ? [] : counting.filter((r) => r.userId === q.userId);
    const oldest = (rows: typeof counting) => (rows.length ? new Date(Math.min(...rows.map((r) => r.at.getTime()))) : null);
    return { all: counting.length, mine: mine.length, oldestAt: oldest(counting), myOldestAt: oldest(mine) };
  }

  async finish(id: string, outcome: RequestOutcome): Promise<void> {
    const row = this.requests.find((r) => r.id === id);
    if (row) row.outcome = outcome;
  }

  async discard(id: string): Promise<void> {
    this.requests = this.requests.filter((r) => r.id !== id);
  }

  async cacheGet(key: string, at: Date): Promise<{ payload: string; fetchedAt: Date } | null> {
    const hit = this.cache.get(key);
    return hit && hit.expiresAt > at ? { payload: hit.payload, fetchedAt: hit.fetchedAt } : null;
  }

  async cachePut(entry: { key: string; provider: string; payload: string; fetchedAt: Date; expiresAt: Date }): Promise<void> {
    this.cache.set(entry.key, { provider: entry.provider, payload: entry.payload, fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt });
  }
}
