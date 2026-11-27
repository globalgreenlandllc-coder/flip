import { REPAIR_LEVELS, type RepairLevel } from "@/lib/engine";
import { HOME_TYPES_SEARCHED, MAX_CHECK, MAX_ZIPS, type DealFinder, type DealSearch, type HomeType } from "@/lib/data/deal-finder";
import { json } from "./analyze";

/**
 * POST /api/v1/deals/find and POST /api/v1/deals/check: the deal finder
 * (lib/data/deal-finder.ts) behind sign-in.
 *
 * find   { zips: string[], price: { min, max }, targetProfit, repair, propertyType }
 *        with { estimate: true }: what the search may cost, from what is kept, asking nothing
 * check  the same, and { ids: string[] }: up to MAX_CHECK homes of the search, as it was kept, looked at one by one
 *
 * Neither asks the AI or counts against the month's analyses. Both spend
 * real sold-price lookups, within the same budget and share as an analysis.
 * Every answer is marked untested: a home found here is a home to look at,
 * never a verdict.
 */

export interface DealsDeps {
  userId: () => Promise<string | null>;
  finder: DealFinder;
}

class BadSearch extends Error {}

const whole = (v: unknown, label: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new BadSearch(`${label} must be a number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`);
  return Math.round(v);
};

/** A search as the person set it, checked before anything is asked. */
export function readSearch(raw: unknown): DealSearch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadSearch("Body must be a JSON object.");
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.zips) || r.zips.length === 0) throw new BadSearch("Give at least one zip code.");
  const zips = [...new Set(r.zips.map((z) => (typeof z === "string" ? z.trim() : "")))];
  if (zips.some((z) => !/^\d{5}$/.test(z))) throw new BadSearch("A zip code is five digits.");
  if (zips.length > MAX_ZIPS) throw new BadSearch(`Search at most ${MAX_ZIPS} zip codes at a time.`);
  const price = r.price && typeof r.price === "object" ? (r.price as Record<string, unknown>) : {};
  const min = whole(price.min, "The lowest price", 0, 20_000_000);
  const max = whole(price.max, "The highest price", 10_000, 20_000_000);
  if (min > max) throw new BadSearch("The lowest price is above the highest.");
  // A profit wanted of nothing would call a home that breaks even hot.
  const targetProfit = whole(r.targetProfit, "The profit you want", 1_000, 5_000_000);
  if (!REPAIR_LEVELS.includes(r.repair as RepairLevel)) throw new BadSearch("The repair is light, medium or heavy.");
  if (!HOME_TYPES_SEARCHED.includes(r.propertyType as HomeType)) throw new BadSearch(`The kind of home is one of: ${HOME_TYPES_SEARCHED.join(", ")}.`);
  return { zips, price: [min, max], targetProfit, repair: r.repair as RepairLevel, propertyType: r.propertyType as HomeType };
}

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadSearch("Body must be JSON.");
  }
}

export function createFindHandler(deps: DealsDeps) {
  return async function POST(req: Request): Promise<Response> {
    const userId = await deps.userId();
    if (!userId) return json({ error: "Sign in to use the API." }, 401);
    let search: DealSearch;
    let estimateOnly = false;
    try {
      const raw = await body(req);
      search = readSearch(raw);
      estimateOnly = (raw as Record<string, unknown>).estimate === true;
    } catch (err) {
      if (err instanceof BadSearch) return json({ error: err.message }, 400);
      throw err;
    }
    try {
      if (estimateOnly) return json({ search, estimate: await deps.finder.estimate(search, userId) });
      return json({ untested: true, search, ...(await deps.finder.find(search, userId)) });
    } catch (err) {
      console.error("[deals] find failed", err instanceof Error ? err.name : typeof err);
      return json({ error: "The search failed. Try again in a minute." }, 500);
    }
  };
}

export function createCheckHandler(deps: DealsDeps) {
  return async function POST(req: Request): Promise<Response> {
    const userId = await deps.userId();
    if (!userId) return json({ error: "Sign in to use the API." }, 401);
    let search: DealSearch;
    let ids: string[];
    try {
      const raw = await body(req);
      search = readSearch(raw);
      const given = (raw as Record<string, unknown>).ids;
      if (!Array.isArray(given) || given.length === 0 || !given.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)) throw new BadSearch("Choose the homes to look at.");
      ids = [...new Set(given as string[])];
      if (ids.length > MAX_CHECK) throw new BadSearch(`Look at ${MAX_CHECK} homes at most at a time.`);
    } catch (err) {
      if (err instanceof BadSearch) return json({ error: err.message }, 400);
      throw err;
    }
    try {
      return json({ untested: true, search, ...(await deps.finder.check(search, ids, userId)) });
    } catch (err) {
      console.error("[deals] check failed", err instanceof Error ? err.name : typeof err);
      return json({ error: "The closer look failed. Try again in a minute." }, 500);
    }
  };
}
