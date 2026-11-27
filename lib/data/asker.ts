import { BudgetExhausted, reserve, type DataBudget, type DataStore, type RequestOutcome } from "./budget";
import { NoAnswer, askRentcast, type Fetcher, type PropertyRecord, type RecordReader, type RentcastReply } from "./rentcast";

/**
 * How a question is put to RentCast, whoever puts it (a house's analysis,
 * house-data.ts; an area's search for deals, deal-finder.ts):
 *
 *   - an answer kept from before is used, and nothing is asked or paid;
 *   - the same question being asked right now by another run is waited for,
 *     for no longer than this one may take, and its answer shared. Only an
 *     answer is shared: a question that was refused or failed was refused or
 *     failed for the one who asked it, so one of those waiting then asks, and
 *     the rest wait for that one;
 *   - otherwise the request is written down against the budget first
 *     (budget.ts), sent, recorded, and its answer kept;
 *   - a request whose run has been given up on by the time it is counted is
 *     not sent, and comes off the record.
 *
 * Nothing here waits for ever: every wait has a limit, and a question that
 * cannot be answered in time throws NotAnswered("unavailable").
 */

export interface RentcastSettings {
  key: string;
  baseUrl: string;
  budget: DataBudget;
}

export const PROVIDER = "rentcast";
const DAY_MS = 86_400_000;
/** How long the bookkeeping around one request (the count before it, the record and the keeping after) may take on top of the request itself. */
export const BOOKKEEPING_MS = 8_000;
/** A question is not started, and a request not sent, with less time than this left for it. */
export const TOO_LATE_MS = 1_000;

/** Why a question got no answer: the budget, this person's share of it, or the service or the database not answering in time. */
export class NotAnswered extends Error {
  constructor(
    readonly code: "budget" | "your-share" | "unavailable",
    readonly opensAt?: Date,
  ) {
    super(code);
    this.name = "NotAnswered";
  }
}

/** A question that was to be answered from what was kept, and nothing was kept for it: nothing was asked. */
export class NotKept extends Error {
  constructor() {
    super("not kept");
    this.name = "NotKept";
  }
}

/** An error as it may be logged: what kind it was, never what it said. Messages quote what was asked, and what was asked is somebody's address. */
export const kind = (err: unknown) => (err instanceof Error ? { name: err.name, code: (err as { code?: unknown }).code } : { name: typeof err });

/** A promise that gives up after `ms`: what it waits for may never settle, and nothing here may wait for ever. */
export function within<T>(promise: Promise<T>, ms: number, late: () => Error = () => new NotAnswered("unavailable")): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(late()), Math.max(1, ms));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** What is kept of an answer. */
interface Kept<T> {
  records: T[];
  returned: number;
  total: number | null;
}

export interface Answer<T = PropertyRecord> {
  reply: RentcastReply<T>;
  readAt: Date;
  /** True when the answer was one kept from before: nothing was asked and nothing paid. */
  kept: boolean;
}

export interface Question<T = PropertyRecord> {
  /** What kind of request it is, as it is written down against the budget: "property", "sales", "listings", "area-sales". */
  what: string;
  /** What the answer is kept under. */
  key: string;
  /**
   * For a question about an address: the address exactly as it was written. An answer that does not hold the
   * house's record is the answer to that writing and to no other ("Apt 4" may be found where "#4" was not), so
   * it is kept under this, and only an answer that does hold the record is kept under `key`, which every
   * writing of the house shares. Two runs wait for each other only when they wrote the address the same way.
   */
  asWritten?: string;
  /** Does the answer hold what was asked for? Only for a question with `asWritten`. */
  found?: (reply: RentcastReply<T>) => boolean;
  /**
   * True for a search: "nothing matched" (RentCast's 404 to a search, which it does not bill) is an answer, kept and
   * shared like one. Not for an address: "no such address" is the answer to one writing of it, costs nothing to ask
   * again, and is asked again.
   */
  emptyIsAnswer?: boolean;
  url: string;
  /** How the answer's records are read. Property records by default. */
  read?: RecordReader<T>;
  /** How long the answer is kept, which may depend on what it says. */
  keptDays: (reply: RentcastReply<T>) => number;
  /** How long this question may take: waiting for another run's answer to it, and then the request itself. */
  timeoutMs: number;
  /** Answer it from what was kept or not at all (NotKept): nothing is asked, nothing spent. */
  keptOnly?: boolean;
}

/** One run (one house's analysis, one area's search): given up on when its time is over, after which it sends nothing more. */
export interface Run {
  over: boolean;
}

export interface AskerDeps {
  store: DataStore;
  now: () => Date;
  fetcher?: Fetcher;
  /** How long the bookkeeping around one request may take on top of it. Default BOOKKEEPING_MS; a test sets it. */
  bookkeepingMs?: number;
}

export interface Asker {
  question<T = PropertyRecord>(settings: RentcastSettings, q: Question<T>, userId: string | null, run: Run): Promise<Answer<T>>;
}

export function createAsker(deps: AskerDeps): Asker {
  /** Questions being asked right now, by what they are kept under (or, for an address, by how it was written). */
  const beingAsked = new Map<string, Promise<Answer<unknown>>>();
  const bookkeepingMs = deps.bookkeepingMs ?? BOOKKEEPING_MS;

  const nothing = <T>(q: Question<T>, reply: RentcastReply<T>) => Boolean(q.emptyIsAnswer) && reply.status === 404;
  const answered = <T>(q: Question<T>, reply: RentcastReply<T>) => (reply.status === 200 && !reply.garbled) || nothing(q, reply);

  async function question<T = PropertyRecord>(settings: RentcastSettings, q: Question<T>, userId: string | null, run: Run): Promise<Answer<T>> {
    const began = performance.now();
    const left = () => q.timeoutMs - (performance.now() - began);

    // What was kept: under the question's own name, or, for an address, under the address as it was written (an
    // answer that was not the house's). A database that does not answer is no answer: the question is then asked,
    // if the budget can be counted.
    for (const key of q.asWritten ? [q.key, q.asWritten] : [q.key]) {
      const cached = await within(deps.store.cacheGet(key, deps.now()), Math.min(q.timeoutMs, bookkeepingMs)).catch((err) => {
        console.error("[rentcast] could not read the kept answers", kind(err));
        return null;
      });
      if (!cached) continue;
      try {
        const kept = JSON.parse(cached.payload) as Partial<Kept<T>>;
        if (Array.isArray(kept.records)) return { reply: { status: 200, records: kept.records, returned: kept.returned ?? kept.records.length, total: kept.total ?? null }, readAt: cached.fetchedAt, kept: true };
      } catch {
        /* a kept answer that cannot be read is asked for again */
      }
    }

    if (q.keptOnly) throw new NotKept();

    // The same question, being asked right now by another run: its answer is waited for, for no longer than this
    // question may take. If that one fails, the first of those waiting asks, and the others wait for it in turn.
    const flight = q.asWritten ?? q.key;
    for (;;) {
      const running = beingAsked.get(flight) as Promise<Answer<T>> | undefined;
      if (!running || left() < TOO_LATE_MS) break;
      const shared = await within(running, left()).catch(() => null);
      if (shared && answered(q, shared.reply)) return shared;
      if (beingAsked.get(flight) === running) break;
    }
    if (run.over || left() < TOO_LATE_MS) throw new NotAnswered("unavailable");

    let givenUp = false;
    const asking = within(
      (async (): Promise<Answer<T>> => {
        let id: string;
        try {
          id = await reserve(deps.store, settings.budget, { provider: PROVIDER, kind: q.what, userId, at: deps.now() });
        } catch (err) {
          if (err instanceof BudgetExhausted) throw new NotAnswered(err.scope === "all" ? "budget" : "your-share", err.opensAt);
          // No count, no request: what cannot be counted is not spent.
          console.error("[rentcast] the request budget could not be checked", kind(err));
          throw new NotAnswered("unavailable");
        }
        // Counting took so long that nobody is waiting for this answer any more: the request is not sent, and comes off the record.
        if (givenUp || run.over || left() < TOO_LATE_MS) {
          await deps.store.discard(id).catch((err) => console.error("[rentcast] could not take back a request that was not sent", kind(err)));
          throw new NotAnswered("unavailable");
        }
        const started = deps.now().getTime();
        const record = (outcome: RequestOutcome) => deps.store.finish(id, { ...outcome, ms: deps.now().getTime() - started }).catch((err) => console.error("[rentcast] could not record a request", kind(err)));
        let reply: RentcastReply<T>;
        try {
          reply = await askRentcast<T>(q.url, settings.key, deps.fetcher, left(), q.read);
        } catch (err) {
          await record({ status: "unknown" });
          console.error("[rentcast] no answer", { what: q.what, why: err instanceof NoAnswer ? err.why : "error" });
          throw new NotAnswered("unavailable");
        }
        await record({ status: reply.status === 200 ? "billed" : "free", httpStatus: reply.status, results: reply.returned });
        const readAt = deps.now();
        if (answered(q, reply)) {
          // "Nothing matched" is kept as that: an answer with no records in it.
          const kept: Kept<T> = nothing(q, reply) ? { records: [], returned: 0, total: 0 } : { records: reply.records, returned: reply.returned, total: reply.total };
          // An answer about an address that is not the house's is kept under that writing of the address alone.
          const key = q.asWritten && !q.found?.(reply) ? q.asWritten : q.key;
          await deps.store
            .cachePut({ key, provider: PROVIDER, payload: JSON.stringify(kept), fetchedAt: readAt, expiresAt: new Date(readAt.getTime() + q.keptDays(reply) * DAY_MS) })
            .catch((err) => console.error("[rentcast] could not keep an answer", kind(err)));
        }
        return { reply, readAt, kept: false };
      })(),
      // The request has its own limit; this one is for the database around it, which has none of its own.
      left() + bookkeepingMs,
    );
    beingAsked.set(flight, asking as Promise<Answer<unknown>>);
    try {
      return await asking;
    } catch (err) {
      givenUp = true;
      throw err;
    } finally {
      // Only its own entry: a later run may have put its own question here since.
      if (beingAsked.get(flight) === (asking as Promise<Answer<unknown>>)) beingAsked.delete(flight);
    }
  }

  return { question };
}
