import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { BudgetCounts, DataRequestRow, DataStore, RequestOutcome } from "./budget";

/** What counts against the budget: everything but a request answered with a status that is not billed (budget.ts countsAgainstBudget). */
const counting: Prisma.DataRequestWhereInput = { status: { not: "free" } };

/** Expired answers are swept when a new one is kept, this many at most, so the table cannot grow without end. */
const SWEEP = 200;

/** The requests and the kept answers in Postgres (models DataRequest, DataCache). The rules live in budget.ts; MemoryDataStore mirrors these queries. */
export const prismaDataStore: DataStore = {
  async start(row: DataRequestRow): Promise<string> {
    const made = await db.dataRequest.create({ data: { provider: row.provider, kind: row.kind, userId: row.userId, createdAt: row.at }, select: { id: true } });
    return made.id;
  },

  async counted(q: { provider: string; since: Date; userId: string | null }): Promise<BudgetCounts> {
    const all: Prisma.DataRequestWhereInput = { provider: q.provider, createdAt: { gte: q.since }, ...counting };
    const mine: Prisma.DataRequestWhereInput = { ...all, userId: q.userId };
    const oldest = { orderBy: { createdAt: "asc" as const }, select: { createdAt: true } };
    const [allCount, allOldest, myCount, myOldest] = await Promise.all([
      db.dataRequest.count({ where: all }),
      db.dataRequest.findFirst({ where: all, ...oldest }),
      q.userId === null ? 0 : db.dataRequest.count({ where: mine }),
      q.userId === null ? null : db.dataRequest.findFirst({ where: mine, ...oldest }),
    ]);
    return { all: allCount, mine: myCount, oldestAt: allOldest?.createdAt ?? null, myOldestAt: myOldest?.createdAt ?? null };
  },

  async finish(id: string, outcome: RequestOutcome): Promise<void> {
    await db.dataRequest.update({
      where: { id },
      data: { status: outcome.status, httpStatus: outcome.httpStatus ?? undefined, results: outcome.results ?? undefined, ms: outcome.ms === undefined ? undefined : Math.round(outcome.ms) },
    });
  },

  async discard(id: string): Promise<void> {
    await db.dataRequest.deleteMany({ where: { id } });
  },

  async cacheGet(key: string, at: Date): Promise<{ payload: string; fetchedAt: Date } | null> {
    const hit = await db.dataCache.findUnique({ where: { key }, select: { payload: true, fetchedAt: true, expiresAt: true } });
    return hit && hit.expiresAt > at ? { payload: hit.payload, fetchedAt: hit.fetchedAt } : null;
  },

  async cachePut(entry: { key: string; provider: string; payload: string; fetchedAt: Date; expiresAt: Date }): Promise<void> {
    const data = { provider: entry.provider, payload: entry.payload, fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt };
    await db.dataCache.upsert({ where: { key: entry.key }, create: { key: entry.key, ...data }, update: data });
    const stale = await db.dataCache.findMany({ where: { expiresAt: { lt: entry.fetchedAt } }, select: { key: true }, take: SWEEP });
    if (stale.length) await db.dataCache.deleteMany({ where: { key: { in: stale.map((s) => s.key) }, expiresAt: { lt: entry.fetchedAt } } });
  },
};
