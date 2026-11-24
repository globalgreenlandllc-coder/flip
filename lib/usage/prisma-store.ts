import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CountQuery, RunCounts, RunKind, RunOutcome, UsageStore } from "./limits";

/** Paid for: finished or failed after the AI answered, or still in flight and recent (limits.ts paidFor). */
const paid = (startedSince: Date): Prisma.UsageRunWhereInput => ({ OR: [{ status: { in: ["ok", "failed"] } }, { status: "started", createdAt: { gte: startedSince } }] });

/** The runs in Postgres (model UsageRun). The rules live in limits.ts; MemoryUsageStore mirrors these queries. */
export const prismaUsageStore: UsageStore = {
  async start(run: { userId: string; kind: RunKind; source?: string | null; at: Date }): Promise<string> {
    const row = await db.usageRun.create({ data: { userId: run.userId, kind: run.kind, source: run.source ?? null, createdAt: run.at }, select: { id: true } });
    return row.id;
  },

  async counts(q: CountQuery): Promise<RunCounts> {
    const mineInWindow: Prisma.UsageRunWhereInput = { userId: q.userId, kind: q.kind, createdAt: { gte: q.windowStart } };
    // Quick Numbers is only ever held to its own window.
    if (q.kind === "quick") return { month: 0, windowPaid: 0, windowAll: await db.usageRun.count({ where: mineInWindow }), dayAll: 0 };
    const [month, windowPaid, windowAll, dayAll] = await Promise.all([
      db.usageRun.count({ where: { userId: q.userId, kind: "analyze", createdAt: { gte: q.monthStart }, ...paid(q.startedSince) } }),
      db.usageRun.count({ where: { ...mineInWindow, ...paid(q.startedSince) } }),
      db.usageRun.count({ where: mineInWindow }),
      db.usageRun.count({ where: { kind: "analyze", createdAt: { gte: q.dayStart }, ...paid(q.startedSince) } }),
    ]);
    return { month, windowPaid, windowAll, dayAll };
  },

  async monthUsed(q: Pick<CountQuery, "userId" | "monthStart" | "startedSince">): Promise<number> {
    return db.usageRun.count({ where: { userId: q.userId, kind: "analyze", createdAt: { gte: q.monthStart }, ...paid(q.startedSince) } });
  },

  async finish(id: string, outcome: RunOutcome): Promise<void> {
    await db.usageRun.update({
      where: { id },
      data: {
        status: outcome.status,
        photos: outcome.photos ?? undefined,
        model: outcome.model ?? undefined,
        inputTokens: outcome.inputTokens ?? undefined,
        outputTokens: outcome.outputTokens ?? undefined,
        ms: outcome.ms === undefined ? undefined : Math.round(outcome.ms),
      },
    });
  },

  async discard(id: string): Promise<void> {
    await db.usageRun.deleteMany({ where: { id } });
  },
};
