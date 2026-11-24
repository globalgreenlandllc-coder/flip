import { auth } from "@clerk/nextjs/server";
import { createAnalyzeHandler } from "@/lib/api/analyze";
import { getProviders } from "@/lib/data";
import { fetchListing } from "@/lib/listing/read-listing";
import { resolveByAddress } from "@/lib/listing/resolve";
import { limitsFromEnv } from "@/lib/usage/limits";
import { prismaUsageStore } from "@/lib/usage/prisma-store";
import { analyzePhotos } from "@/lib/vision/analyze-photos";
import { fetchPhotos } from "@/lib/vision/fetch-photo";

export const maxDuration = 120;

/** POST /api/v1/analyze. What it accepts and does is in lib/api/analyze.ts; this file plugs in the real session, database, network and AI. */
export const POST = createAnalyzeHandler({
  userId: async () => (await auth()).userId,
  usage: prismaUsageStore,
  limits: () => limitsFromEnv(),
  now: () => new Date(),
  providers: getProviders,
  fetchListing: (url) => fetchListing(url),
  resolveByAddress,
  fetchPhotos,
  readPhotos: analyzePhotos,
});
