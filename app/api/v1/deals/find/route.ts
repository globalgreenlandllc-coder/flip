import { auth } from "@clerk/nextjs/server";
import { createFindHandler } from "@/lib/api/deals";
import { dealFinder } from "../finder";

export const maxDuration = 120;

/** POST /api/v1/deals/find. What it accepts and does is in lib/api/deals.ts and lib/data/deal-finder.ts. */
export const POST = createFindHandler({ userId: async () => (await auth()).userId, finder: dealFinder });
