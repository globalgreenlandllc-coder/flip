import { auth } from "@clerk/nextjs/server";
import { createEvaluateHandler } from "@/lib/api/evaluate";
import { getProviders } from "@/lib/data";
import { limitsFromEnv } from "@/lib/usage/limits";
import { prismaUsageStore } from "@/lib/usage/prisma-store";

/** POST /api/v1/evaluate. What it accepts and does is in lib/api/evaluate.ts; this file plugs in the real session, database and data. */
export const POST = createEvaluateHandler({
  userId: async () => (await auth()).userId,
  usage: prismaUsageStore,
  limits: () => limitsFromEnv(),
  now: () => new Date(),
  providers: getProviders,
});
