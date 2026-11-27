import { createDealFinder } from "@/lib/data/deal-finder";
import { createHouseData, rentcastFromEnv } from "@/lib/data/house-data";
import { prismaDataStore } from "@/lib/data/prisma-data-store";

/** The deal finder as this deployment runs it: RentCast when RENTCAST_API_KEY is set, the database for its budget and kept answers. */
export const dealFinder = createDealFinder({
  rentcast: () => rentcastFromEnv(),
  store: prismaDataStore,
  now: () => new Date(),
  houseData: createHouseData({ rentcast: () => rentcastFromEnv(), store: prismaDataStore, now: () => new Date() }),
});
