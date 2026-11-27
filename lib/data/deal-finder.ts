import { DEFAULT_DEAL_TERMS, REAL_SALES_CONFIG, REAL_SALES_TIERS, REPAIR_CONDITION, byPromise, haversineMiles, screenListing } from "@/lib/engine";
import type { PropertyFacts, RepairLevel, Sale, ScreenResult } from "@/lib/engine";
import { addressKey } from "./address-match";
import { NotAnswered, NotKept, PROVIDER, createAsker, kind, within, type RentcastSettings, type Run } from "./asker";
import type { DataStore } from "./budget";
import type { DataSource, FactOverrides, HouseAsk, HouseData } from "./house-data";
import { RENTCAST_PAGE, areaSalesUrl, listingFrom, listingsUrl, saleFrom, type Fetcher, type ListingRecord, type PropertyRecord, type RentcastReply } from "./rentcast";

/**
 * The deal finder: the homes for sale in an area, each given a first look
 * (lib/engine/screen.ts) against the homes sold in that area in the last
 * year, so that the few worth a closer look stand out.
 *
 * What is asked, for each zip code searched:
 *
 *   - its homes for sale of the kind searched (RentCast's sale listings),
 *     whatever their price: one request (500 at most; more is said to be a
 *     part), kept a day, since listings are updated daily;
 *   - the homes of that kind sold there in the last twelve months: one or two
 *     requests (1,000 at most), kept a week, like the comps of an analysis.
 *
 * So a zip code and kind of home not searched today costs two or three
 * lookups, and nothing again that day, whatever the price range, profit or
 * repair. `estimate` says before a search what it may cost, from what is
 * kept, asking nothing. Every lookup goes through the same budget, person's
 * share and rules as an analysis (asker.ts).
 *
 * RentCast gives no photos and no description for a home for sale, so the
 * repair is the person's guess (light, medium or heavy), and every number
 * here is a first look, never a verdict. `check` then looks at a few chosen
 * homes one by one, the way an analysis does before its photos are read:
 * the house's own public record and the homes sold right around it. It works
 * from the search as it was kept: it never searches an area again.
 */

export const MAX_ZIPS = 5;
/** The most homes one `check` looks at: each may cost up to five lookups. */
export const MAX_CHECK = 5;
/** The most homes one answer lists, the most promising first. */
export const MAX_HOMES_SHOWN = 1_000;
const LISTINGS_KEPT_DAYS = 1;
const AREA_SALES_KEPT_DAYS = 7;
export const MAX_LISTING_PAGES = 1;
export const MAX_SALES_PAGES = 2;
/** The most lookups one zip code costs a search. */
export const MOST_PER_ZIP = MAX_LISTING_PAGES + MAX_SALES_PAGES;
/** Twelve months, in whole months of 31 days. */
const SALES_DAYS = 372;
/** All the asking for one search may take this long. Its route has two minutes. */
const SEARCH_DEADLINE_MS = 60_000;
/** All of one `check`, from the moment it is asked: no house is started with less than an analysis's own limit left. */
const CHECK_DEADLINE_MS = 100_000;
const HOUSE_LIMIT_MS = 40_000;
/** How long counting the month's lookups may take. */
const COUNT_LIMIT_MS = 5_000;
/** The engine compares a home with sales out to a mile; a little over that is all it is handed. */
const REACH_MILES = 1.05;

export type HomeType = "Single Family" | "Townhouse" | "Condo";
export const HOME_TYPES_SEARCHED: HomeType[] = ["Single Family", "Townhouse", "Condo"];

export interface DealSearch {
  /** One to MAX_ZIPS five-digit zip codes. */
  zips: string[];
  /** The asking prices searched, from and to. */
  price: [number, number];
  /** The profit wanted after the renovation and the sale, after every cost. */
  targetProfit: number;
  repair: RepairLevel;
  propertyType: HomeType;
}

/**
 * ok: read. budget / your-share: the lookups are used up. unavailable: RentCast did not answer in time.
 * refused: RentCast turned flip away. late: the search ran out of time before the zip code was read in full.
 * not-kept: a closer look works from the search as it was kept, and nothing was kept for the zip code.
 */
export type AreaStatus = "ok" | "budget" | "your-share" | "unavailable" | "refused" | "late" | "not-kept";

export interface AreaRead {
  zip: string;
  status: AreaStatus;
  /** Why the zip code could not be read, said for the person. */
  message?: string;
  /** Homes for sale RentCast returned, and whether more were for sale than were read. */
  listings: { found: number; sampled: boolean; readAt: string | null };
  /** Homes sold there in the last twelve months: returned, with a usable price and size, and whether more sold than were read. */
  sales: { found: number; usable: number; sampled: boolean; newestSale: string | null; readAt: string | null };
}

export interface CheckedHome {
  /** "ok": looked at on its own. "demo": real data could not be had for it, and `message` says why. "skipped": not reached in time. */
  status: "ok" | "demo" | "skipped";
  message?: string;
  screen?: ScreenResult;
  source?: DataSource;
}

export interface FoundHome {
  listing: ListingRecord;
  screen: ScreenResult;
  /** Why the home could not be valued, when it could not. */
  why?: string;
  checked?: CheckedHome;
}

export interface DealSearchAnswer {
  /** False when real sold prices are not connected: nothing was searched. */
  connected: boolean;
  areas: AreaRead[];
  /** The homes for sale in the price range, the most promising first: MAX_HOMES_SHOWN at most. */
  homes: FoundHome[];
  /** How many homes for sale are in the price range, listed or not. */
  inRange: number;
  /** Homes for sale that were read and are outside the price range. */
  outOfRange: number;
  /** The lookups of the last 31 days: everyone's and this person's. Null when they could not be counted. */
  lookups: { used: number; of: number; mine: number; myShare: number } | null;
  /** The day the homes were valued on (YYYY-MM-DD). */
  asOf: string;
  /** For a closer look: the homes chosen that are not in the search as it was kept. */
  notFound?: string[];
}

/** What a search may cost before it is made: for each zip code, the most lookups it may use (0 when all it needs was kept today). */
export interface DealSearchEstimate {
  connected: boolean;
  zips: { zip: string; upTo: number }[];
  upTo: number;
  lookups: DealSearchAnswer["lookups"];
}

export interface DealFinderDeps {
  rentcast: () => RentcastSettings | null;
  store: DataStore;
  now: () => Date;
  /** A house's own data, as an analysis gets it (house-data.ts): for `check`. */
  houseData: (ask: HouseAsk) => Promise<HouseData>;
  fetcher?: Fetcher;
  /** All the asking for one search may take this long. Default SEARCH_DEADLINE_MS; a test sets it. */
  deadlineMs?: number;
  /** All of one check. Default CHECK_DEADLINE_MS; a test sets it. */
  checkDeadlineMs?: number;
  /** The most one house of a check may take. Default HOUSE_LIMIT_MS; a test sets it. */
  houseLimitMs?: number;
  bookkeepingMs?: number;
}

export interface DealFinder {
  estimate(search: DealSearch, userId: string): Promise<DealSearchEstimate>;
  find(search: DealSearch, userId: string): Promise<DealSearchAnswer>;
  /** The search as it was kept (nothing is searched again), with the chosen homes, MAX_CHECK at most, looked at one by one. */
  check(search: DealSearch, ids: string[], userId: string): Promise<DealSearchAnswer>;
}

const DAY_MS = 86_400_000;
const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

function areaMessage(status: AreaStatus, zip: string, opensAt?: Date): string | undefined {
  const opens = opensAt ? `; more open up on ${longDate(opensAt)}` : "";
  switch (status) {
    case "budget":
      return `flip's real sold-price lookups are used up for now${opens}, so ${zip} could not be searched.`;
    case "your-share":
      return `You have used your share of real sold-price lookups for now${opens}, so ${zip} could not be searched.`;
    case "unavailable":
      return `The service flip reads homes for sale from did not answer for ${zip} just now. Search again in a few minutes.`;
    case "refused":
      return `The service flip reads homes for sale from turned flip away, so ${zip} could not be searched. That is ours to fix, and searching again will not help until it is.`;
    case "late":
      return `The search ran out of time before ${zip} was read in full. Search again to include it: what was read is kept.`;
    case "not-kept":
      return `${zip} is not in the search as it was kept today, so its homes could not be looked at. Search again first.`;
    default:
      return undefined;
  }
}

/** Not an answer from RentCast: why. */
class Refused extends Error {
  constructor(readonly status: number) {
    super(`status ${status}`);
  }
}

/** The search's own time ran out before a question was asked: nothing was sent for it. */
class OutOfTime extends Error {}

const listingsKey = (zip: string, type: string, page: number) => `${PROVIDER}:listings:v1:${zip}:${type}:${page}`;
const salesKey = (zip: string, type: string, page: number) => `${PROVIDER}:area-sales:v1:${zip}:${type}:${SALES_DAYS}:${page}`;

/** The sold homes near a point, quickly: sorted by latitude once, then only those within REACH_MILES of each home are looked at. */
function nearIndex(sales: Sale[]) {
  const sorted = [...sales].sort((a, b) => a.lat - b.lat);
  const lats = sorted.map((s) => s.lat);
  return (lat: number, lng: number): Sale[] => {
    const dLat = REACH_MILES / 69.0;
    const dLng = REACH_MILES / (69.17 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    let lo = 0;
    let hi = lats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lats[mid] < lat - dLat) lo = mid + 1;
      else hi = mid;
    }
    const out: Sale[] = [];
    for (let i = lo; i < sorted.length && sorted[i].lat <= lat + dLat; i++) {
      if (Math.abs(sorted[i].lng - lng) <= dLng) out.push(sorted[i]);
    }
    return out;
  };
}

export function createDealFinder(deps: DealFinderDeps): DealFinder {
  const asker = createAsker({ store: deps.store, now: deps.now, fetcher: deps.fetcher, bookkeepingMs: deps.bookkeepingMs });
  const today = () => deps.now().toISOString().slice(0, 10);

  /** Every page of one search (up to `pages`), as one list: read, sampled (more matched than were read), and when the oldest page was read. */
  async function pages<T>(
    settings: RentcastSettings,
    ask: (page: number) => { what: string; key: string; url: string; read?: (raw: unknown) => T | null; keptDays: number },
    maxPages: number,
    userId: string,
    run: Run,
    timeLeft: () => number,
    keptOnly: boolean,
  ) {
    const records: T[] = [];
    let readAt: Date | null = null;
    let sampled = false;
    for (let page = 0; page < maxPages; page++) {
      const q = ask(page);
      const got = await asker.question<T>(settings, { what: q.what, key: q.key, url: q.url, read: q.read, emptyIsAnswer: true, keptOnly, keptDays: () => q.keptDays, timeoutMs: timeLeft() }, userId, run);
      const reply: RentcastReply<T> = got.reply;
      if (reply.status === 404) break;
      if (reply.status !== 200 || reply.garbled) throw new Refused(reply.status);
      records.push(...reply.records);
      if (readAt === null || got.readAt < readAt) readAt = got.readAt;
      const more = reply.total === null ? reply.returned >= RENTCAST_PAGE : reply.total > (page + 1) * RENTCAST_PAGE;
      if (!more) break;
      if (page === maxPages - 1) sampled = true;
    }
    return { records, readAt, sampled };
  }

  async function readArea(settings: RentcastSettings, zip: string, search: DealSearch, userId: string, run: Run, timeLeft: () => number, keptOnly: boolean): Promise<{ area: AreaRead; listings: ListingRecord[]; sales: PropertyRecord[] }> {
    const type = search.propertyType;
    const empty = { listings: { found: 0, sampled: false, readAt: null }, sales: { found: 0, usable: 0, sampled: false, newestSale: null, readAt: null } };
    try {
      const listed = await pages<ListingRecord>(
        settings,
        (page) => ({ what: "listings", key: listingsKey(zip, type, page), url: listingsUrl(settings.baseUrl, { zip, propertyType: type, offset: page * RENTCAST_PAGE }), read: listingFrom, keptDays: LISTINGS_KEPT_DAYS }),
        MAX_LISTING_PAGES,
        userId,
        run,
        timeLeft,
        keptOnly,
      );
      const sold = await pages<PropertyRecord>(
        settings,
        (page) => ({ what: "area-sales", key: salesKey(zip, type, page), url: areaSalesUrl(settings.baseUrl, { zip, propertyType: type, days: SALES_DAYS, offset: page * RENTCAST_PAGE }), keptDays: AREA_SALES_KEPT_DAYS }),
        MAX_SALES_PAGES,
        userId,
        run,
        timeLeft,
        keptOnly,
      );
      const usable = sold.records.flatMap((r) => saleFrom(r) ?? []);
      const newestSale = usable.reduce<string | null>((newest, s) => (newest === null || s.saleDate > newest ? s.saleDate : newest), null);
      return {
        area: {
          zip,
          status: "ok",
          listings: { found: listed.records.length, sampled: listed.sampled, readAt: listed.readAt?.toISOString() ?? null },
          sales: { found: sold.records.length, usable: usable.length, sampled: sold.sampled, newestSale, readAt: sold.readAt?.toISOString() ?? null },
        },
        listings: listed.records,
        sales: sold.records,
      };
    } catch (err) {
      let status: AreaStatus = "unavailable";
      let opensAt: Date | undefined;
      if (err instanceof NotAnswered) [status, opensAt] = [err.code, err.opensAt];
      else if (err instanceof Refused) status = err.status === 401 || err.status === 403 ? "refused" : "unavailable";
      else if (err instanceof OutOfTime) status = "late";
      else if (err instanceof NotKept) status = "not-kept";
      else console.error("[deals] an area could not be read", kind(err));
      return { area: { zip, status, message: areaMessage(status, zip, opensAt), ...empty }, listings: [], sales: [] };
    }
  }

  async function lookups(settings: RentcastSettings, userId: string): Promise<DealSearchAnswer["lookups"]> {
    try {
      const since = new Date(deps.now().getTime() - settings.budget.windowDays * DAY_MS);
      const counts = await within(deps.store.counted({ provider: PROVIDER, since, userId }), COUNT_LIMIT_MS);
      return { used: counts.all, of: settings.budget.requests, mine: counts.mine, myShare: settings.budget.perPerson };
    } catch (err) {
      console.error("[deals] the lookups could not be counted", kind(err));
      return null;
    }
  }

  function screenAll(search: DealSearch, listings: ListingRecord[], records: PropertyRecord[], asOf: string): { homes: FoundHome[]; inRange: number; outOfRange: number } {
    // One pool of sold homes for the whole search: a home near the edge of one zip code is valued against the next one's too, if that was searched.
    const byId = new Map<string, Sale>();
    for (const r of records) {
      const sale = saleFrom(r);
      if (sale && !byId.has(sale.id)) byId.set(sale.id, sale);
    }
    const near = nearIndex([...byId.values()]);
    const keys = new Map<Sale, string>();
    const keyOf = (s: Sale) => {
      let k = keys.get(s);
      if (k === undefined) keys.set(s, (k = addressKey(s.address ?? "")));
      return k;
    };
    const terms = { ...DEFAULT_DEAL_TERMS, targetProfit: search.targetProfit };
    const condition = REPAIR_CONDITION[search.repair];
    const tiers = REAL_SALES_TIERS.slice(0, 3);
    const widest = tiers[tiers.length - 1];
    const seen = new Set<string>();
    const homes: FoundHome[] = [];
    let outOfRange = 0;
    for (const listing of listings) {
      if (seen.has(listing.id)) continue;
      seen.add(listing.id);
      if (listing.price < search.price[0] || listing.price > search.price[1]) {
        outOfRange++;
        continue;
      }
      if (listing.sqft === null) {
        homes.push({ listing, why: "The listing does not give the living area, so it cannot be compared with sold homes.", screen: { heat: "unknown", arv: null, rehab: { low: 0, likely: 0, high: 0 }, profit: null, worstCaseProfit: null, maxOffer: null } });
        continue;
      }
      // The home's own last sale is not one of its comps.
      const own = addressKey(listing.address);
      const comps = near(listing.lat, listing.lng).filter((s) => s.id !== listing.id && keyOf(s) !== own);
      const subject: PropertyFacts = { id: listing.id, lat: listing.lat, lng: listing.lng, submarket: listing.zip ?? "zip not on record", sqft: listing.sqft, lotSqft: listing.lotSqft, beds: listing.beds, baths: listing.baths, yearBuilt: listing.yearBuilt, garage: null, condition };
      const screen = screenListing({ subject, askingPrice: listing.price, sales: comps, asOf, config: REAL_SALES_CONFIG, tiers, terms });
      let why: string | undefined;
      if (screen.heat === "unknown") {
        // Said by what was there: no sale of its size near it, or sales left out for what differs from it.
        const sqft = listing.sqft;
        const similar = comps.filter((s) => Math.abs(s.sqft - sqft) / sqft <= widest.sqftTolerance && haversineMiles(listing.lat, listing.lng, s.lat, s.lng) <= widest.radiusMiles).length;
        why =
          similar === 0
            ? "No home of similar size sold within a mile of it in the last twelve months, in the zip codes searched."
            : `${similar} home${similar === 1 ? "" : "s"} of similar size sold within a mile of it, but none is close enough to it, once what differs between them is counted, to value it from.`;
      }
      homes.push({ listing, screen, ...(why ? { why } : {}) });
    }
    homes.sort(byPromise);
    return { homes: homes.slice(0, MAX_HOMES_SHOWN), inRange: homes.length, outOfRange };
  }

  async function searchAreas(search: DealSearch, userId: string, keptOnly: boolean): Promise<DealSearchAnswer> {
    const asOf = today();
    const settings = deps.rentcast();
    if (!settings) return { connected: false, areas: [], homes: [], inRange: 0, outOfRange: 0, lookups: null, asOf };
    const run: Run = { over: false };
    const began = performance.now();
    const deadline = deps.deadlineMs ?? SEARCH_DEADLINE_MS;
    const timeLeft = () => {
      const left = deadline - (performance.now() - began);
      if (left < 2_000) throw new OutOfTime();
      return Math.min(20_000, left);
    };
    // The zip codes one after another: the same budget is counted for each, and a search of five costs what five searches do.
    const read: Awaited<ReturnType<typeof readArea>>[] = [];
    try {
      for (const zip of search.zips) read.push(await readArea(settings, zip, search, userId, run, timeLeft, keptOnly));
    } finally {
      run.over = true;
    }
    const { homes, inRange, outOfRange } = screenAll(
      search,
      read.flatMap((r) => r.listings),
      read.flatMap((r) => r.sales),
      asOf,
    );
    return { connected: true, areas: read.map((r) => r.area), homes, inRange, outOfRange, lookups: await lookups(settings, userId), asOf };
  }

  /** The kept answer under `key`, without asking anything; null when nothing is kept (or the database cannot say). */
  async function kept(key: string): Promise<{ total: number | null; returned: number } | null> {
    try {
      const got = await within(deps.store.cacheGet(key, deps.now()), COUNT_LIMIT_MS);
      if (!got) return null;
      const parsed = JSON.parse(got.payload) as { total?: number | null; returned?: number; records?: unknown[] };
      return Array.isArray(parsed.records) ? { total: parsed.total ?? null, returned: parsed.returned ?? parsed.records.length } : null;
    } catch {
      return null;
    }
  }

  async function estimate(search: DealSearch, userId: string): Promise<DealSearchEstimate> {
    const settings = deps.rentcast();
    if (!settings) return { connected: false, zips: [], upTo: 0, lookups: null };
    const type = search.propertyType;
    const zips: DealSearchEstimate["zips"] = [];
    for (const zip of search.zips) {
      let upTo = (await kept(listingsKey(zip, type, 0))) ? 0 : MAX_LISTING_PAGES;
      // Sold homes: the first page, and the second only where the first says more sold than it holds.
      const first = await kept(salesKey(zip, type, 0));
      if (!first) upTo += MAX_SALES_PAGES;
      else if ((first.total ?? (first.returned >= RENTCAST_PAGE ? Infinity : 0)) > RENTCAST_PAGE && !(await kept(salesKey(zip, type, 1)))) upTo += 1;
      zips.push({ zip, upTo });
    }
    return { connected: true, zips, upTo: zips.reduce((sum, z) => sum + z.upTo, 0), lookups: await lookups(settings, userId) };
  }

  async function check(search: DealSearch, ids: string[], userId: string): Promise<DealSearchAnswer> {
    // One clock for all of it, from the moment it is asked.
    const began = performance.now();
    const found = await searchAreas(search, userId, true);
    if (!found.connected) return found;
    const asked = [...new Set(ids)].slice(0, MAX_CHECK);
    const terms = { ...DEFAULT_DEAL_TERMS, targetProfit: search.targetProfit };
    const notFound: string[] = [];
    const deadline = deps.checkDeadlineMs ?? CHECK_DEADLINE_MS;
    const houseLimit = deps.houseLimitMs ?? HOUSE_LIMIT_MS;
    for (const id of asked) {
      const home = found.homes.find((h) => h.listing.id === id);
      if (!home) {
        notFound.push(id);
        continue;
      }
      if (performance.now() - began > deadline - houseLimit) {
        home.checked = { status: "skipped", message: "Not reached this time. Check it again." };
        continue;
      }
      const { listing } = home;
      // What the listing says of the house stands over the record's, as in an analysis.
      const overrides: FactOverrides = {};
      for (const [key, value] of [["sqft", listing.sqft], ["lotSqft", listing.lotSqft], ["beds", listing.beds], ["baths", listing.baths], ["yearBuilt", listing.yearBuilt]] as const) {
        if (value !== null) overrides[key] = value;
      }
      const data = await deps.houseData({ address: listing.address, overrides, userId, asOf: found.asOf });
      if (data.demo || !data.source) {
        home.checked = { status: "demo", message: data.fallback?.message ?? "Real sold prices could not be had for this home." };
        continue;
      }
      const screen = screenListing({ subject: { ...data.facts, condition: REPAIR_CONDITION[search.repair] }, askingPrice: listing.price, sales: data.sales, asOf: found.asOf, config: data.config, tiers: data.tiers, terms, withComps: true });
      home.checked = { status: "ok", screen, source: data.source };
    }
    const settings = deps.rentcast();
    return { ...found, ...(notFound.length ? { notFound } : {}), lookups: settings ? await lookups(settings, userId) : found.lookups };
  }

  return { estimate, find: (search, userId) => searchAreas(search, userId, false), check };
}
