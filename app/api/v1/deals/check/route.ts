import { auth } from "@clerk/nextjs/server";
import { createCheckHandler } from "@/lib/api/deals";
import { dealFinder } from "../finder";

export const maxDuration = 120;

/** POST /api/v1/deals/check. What it accepts and does is in lib/api/deals.ts and lib/data/deal-finder.ts. */
export const POST = createCheckHandler({ userId: async () => (await auth()).userId, finder: dealFinder });
