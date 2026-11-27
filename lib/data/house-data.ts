import { DEFAULT_MARKET_CONFIG, REAL_SALES_CONFIG, REAL_SALES_TIERS, RELAXATION_TIERS, selectComps } from "@/lib/engine";
import type { CompCriteria, MarketConfig, PropertyFacts, Sale } from "@/lib/engine";
import { addressKey, sameHouseAddress, takeApart } from "./address-match";
import { NotAnswered, PROVIDER, createAsker, kind, within, type Answer, type Question, type RentcastSettings, type Run } from "./asker";
import { dataBudgetFromEnv, type DataStore } from "./budget";
import { HOME_TYPES, RENTCAST_BASE_URL, RENTCAST_PAGE, propertyUrl, saleFrom, salesUrl, type Fetcher, type PropertyRecord, type RentcastReply } from "./rentcast";
import { SyntheticProvider } from "./synthetic-provider";

/**
 * Everything the analysis needs to know about one house from outside the
 * listing: its public record, and the sold homes it can be compared with.
 *
 * With RentCast connected that is the real record at the listing's address
 * and real sales around it. Whenever those cannot be had for a house (no
 * address, no such record, the request budget used up, the service down) the
 * analysis still runs, on the demo's made-up data, and says in the first
 * line of its DEMO notice why. A result is never part real sales and part
 * made-up ones.
 *
 * How the sales are asked for. One request returns at most 500 records, and
 * which 500 is not said (asked for five miles around a house in Graham, the
 * real service left out nearly everything between one mile and three). So the
 * search is made in the steps the engine itself widens by, each small enough
 * to come back whole wherever houses stand close together:
 *
 *   1. a mile, a year, homes within 30% of this one's size. In a town that
 *      is everything the engine's first three tiers look at, and enough.
 *   2. only if that leaves fewer than five comparable sales: two and a half
 *      miles, eighteen months, 35%. The edge of town, or an unusual house.
 *   3. only if that still does: five miles, two years, 40%. The country,
 *      where five sales like the house are miles and months apart.
 *
 * And when a step matched more than one request returns, it is asked again
 * over the radius that would hold about 425 of the matches if they were
 * spread evenly. When that comes back whole, the nearest sales are all there
 * and only the far ring is a sample. When it does not (homes stand closer
 * together near this one), or cannot be asked, what was read is a part and
 * not known to hold the nearest, and the result says which of the two it is.
 *
 * So a run costs two requests for a house in a town (its record, one
 * search) and three or four further out. Five is the most one run may send
 * (its record and MAX_SEARCHES searches, answered or not), and the caller has
 * its answer inside HOUSE_DEADLINE_MS whatever the database and the service
 * do. Every answer is kept (budget.ts DataStore), "nothing matched" among
 * them, and a later run asks the same questions in the same order, so it is
 * answered from what was kept and stops where the first one stopped: the same
 * house, with a size within the same hundred square feet, costs nothing more
 * for a week. What a later run does pay for is what an earlier one asked and
 * got no answer to.
 *
 * The sold homes are read as they stand today. A valuation dated another day
 * (the API takes a date) is not built on them: a record keeps only a home's
 * last sale, so what sold before a later sale is no longer there to be read.
 */

export type FallbackCode = "no-address" | "not-found" | "not-matched" | "other-date" | "budget" | "your-share" | "unavailable" | "refused" | "not-a-house" | "no-size" | "no-prices";

/** Why a house got the demo's data when real data is connected. */
export interface Fallback {
  code: FallbackCode;
  /** One sentence for the person, said before the demo notice. */
  message: string;
}

/** Where a real result's data came from: shown with the result and saved with a deal. */
export interface DataSource {
  name: string;
  record: {
    address: string;
    propertyType: string | null;
    county: string | null;
    lastSale: { date: string; price: number } | null;
    /** The day of its last sale on record when the record gives the day and no price. */
    soldOn: string | null;
    /** When the record was read from the provider (ISO). */
    readAt: string;
  };
  search: {
    /** How far and how far back the search went in the end. */
    radiusMiles: number;
    months: number;
    /** Sold homes the provider returned (the house itself not counted), and how many of them have a usable price, date and size. */
    found: number;
    usable: number;
    /** The newest sale among them (YYYY-MM-DD). */
    newestSale: string | null;
    /** More matched than one request returns: what is here is a part of what matched. */
    sampled: boolean;
    /** When sampled: every match within this many miles was read, and the part is of the ring beyond. Null: no such radius is known, and what was read is not known to hold the nearest. */
    wholeWithinMiles: number | null;
    /** The search ended before it found five comparable sales and before its widest step: a wider step could not be asked. */
    stoppedEarly: boolean;
    /** When the sold homes were read: the oldest of the answers they came from (ISO). An answer is kept for up to a week. */
    readAt: string;
  };
}

export const RECORDED_KEYS = ["sqft", "lotSqft", "beds", "baths", "yearBuilt", "garage"] as const;
/** The house's facts as the provider's record gives them. Null: the record does not say. */
export type RecordedFacts = Record<(typeof RECORDED_KEYS)[number], number | null>;
/** What the listing and the caller say of the house. Each stands over the record's. */
export type FactOverrides = Partial<RecordedFacts>;

export interface HouseData {
  /** "rentcast", or "synthetic" for the demo. */
  provider: string;
  demo: boolean;
  /** Set when real data is connected and this house got the demo's all the same. */
  fallback?: Fallback;
  recorded: RecordedFacts;
  /** The record with what the listing and the caller say laid over it: what the valuation uses. Its condition is a stand-in until the photos are read. */
  facts: PropertyFacts;
  sales: Sale[];
  config: MarketConfig;
  /** The search tiers the engine may use on these sales: for real data, no wider than the search itself went. */
  tiers: CompCriteria[];
  source?: DataSource;
}

export interface HouseAsk {
  address?: string;
  overrides: FactOverrides;
  /** Who is asking: each person has a share of the request budget. Null for a script. */
  userId: string | null;
  /** The valuation date (YYYY-MM-DD). */
  asOf: string;
}

export type { RentcastSettings } from "./asker";

/**
 * RentCast as this deployment is set up for it, or null when it is not: no
 * key, a key that cannot be one, or a budget of 0. `RENTCAST_BASE_URL` is for
 * a stand-in on this machine; anything that is not https or this machine is
 * ignored.
 */
export function rentcastFromEnv(env: Record<string, string | undefined> = process.env): RentcastSettings | null {
  const key = env.RENTCAST_API_KEY?.trim();
  const budget = dataBudgetFromEnv(env);
  if (!key || budget.requests === 0) return null;
  // A key is one run of printable characters. One with a space or a line break in it was pasted wrong,
  // and would be refused as a header in a way that quotes it.
  if (!/^[\x21-\x7e]{8,200}$/.test(key)) {
    console.error("[rentcast] RENTCAST_API_KEY is set but is not a key (a space or a line break in it?). Real sold prices are off.");
    return null;
  }
  const given = env.RENTCAST_BASE_URL?.trim().replace(/\/+$/, "");
  const usable = given && (/^https:\/\/[^/]/.test(given) || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(given));
  return { key, baseUrl: usable ? given : RENTCAST_BASE_URL, budget };
}

const DAY_MS = 86_400_000;
const PROPERTY_KEPT_DAYS = 30;
const SALES_KEPT_DAYS = 7;
const MISS_KEPT_DAYS = 1;

/**
 * The search steps (see the top of the file): the engine's own third, fourth
 * and fifth tier. `tiers`: how many of REAL_SALES_TIERS lie wholly inside the
 * step, the first two being narrower cuts of the first step.
 */
const STEPS = [2, 3, 4].map((tier) => ({ ...REAL_SALES_TIERS[tier], tiers: tier + 1 }));

/** A step that matched more than one request returns is asked again over the radius expected to hold this share of a full request. */
const REFILL = 0.85;
const MIN_RADIUS_MILES = 0.2;
/** The most searches one run may ask for, answered or not, kept or not: with the record, five requests. */
export const MAX_SEARCHES = 4;
/** All the asking for one house may take this long together. The route it runs in has two minutes, and the AI needs most of them. */
const HOUSE_DEADLINE_MS = 40_000;
/** A search that returns this many records with hardly a price among them is in a place that does not publish prices. */
const PRICES_EXPECTED_OF = 10;
const PRICED_SHARE = 0.1;

/** Why the real data could not be had; becomes a Fallback. */
class Unavailable extends Error {
  constructor(
    readonly code: FallbackCode,
    readonly detail: { opensAt?: Date; propertyType?: string; answered?: string } = {},
  ) {
    super(code);
  }
}

const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
/** An address as one line, for showing and for sending. */
const oneLine = (address: string) => address.replace(/\s+/g, " ").trim();
const shown = (address: string) => (address.length > 90 ? `${address.slice(0, 90)}…` : address);

function fallbackFor(err: Unavailable, ask: HouseAsk): Fallback {
  const where = ask.address ? shown(oneLine(ask.address)) : "this house";
  const opens = err.detail.opensAt ? `; more open up on ${longDate(err.detail.opensAt)}` : "";
  const type = err.detail.propertyType;
  const messages: Record<FallbackCode, string> = {
    "no-address": "No address came with this listing, so real sold prices could not be looked up. Paste the listing link or the listing page to get them.",
    "not-found": `The public records Renoflip reads (through RentCast) have no property at ${where}. Check the address on the listing; a home in a building needs its unit number.`,
    // A record did come back. It is not said to be missing: it could not be told to be this house's.
    "not-matched": `The public records Renoflip reads (through RentCast) answered ${where} with the record of ${shown(err.detail.answered ?? "another address")}, which Renoflip could not tell to be the same home, so it was not used. Check the address on the listing; a home in a building needs its unit number.`,
    "other-date": `Real sold prices are read as they stand today, so a valuation dated ${ask.asOf} cannot be built on them.`,
    budget: `Renoflip's real sold-price lookups are used up for now${opens}.`,
    "your-share": `You have used your share of real sold-price lookups for now${opens}.`,
    unavailable: "The service Renoflip reads real sold prices from did not answer just now. Run it again in a few minutes to get them.",
    refused: "The service Renoflip reads real sold prices from turned Renoflip away. That is ours to fix, and running it again will not help until it is.",
    "not-a-house": `Public records list ${where} as ${type === "Land" ? "land" : type === "Apartment" ? "an apartment building" : "a multi-family property"}, and Renoflip values single homes only.`,
    "no-size": `Neither the listing nor the public record gives the living area of ${where}, so it could not be compared with sold homes.`,
    "no-prices": `The public records around ${where} give the dates homes sold on but not the prices (some states do not publish them), so there are no real sold prices to compare with.`,
  };
  return { code: err.code, message: messages[err.code] };
}

/** A record's facts with what the listing and the caller say laid over them. */
function overlay(recorded: RecordedFacts, overrides: FactOverrides): RecordedFacts {
  const out = { ...recorded };
  for (const key of RECORDED_KEYS) {
    const given = overrides[key];
    if (typeof given === "number") out[key] = given;
  }
  return out;
}

export interface HouseDataDeps {
  /** RentCast's settings, or null when it is not connected. Asked on every run. */
  rentcast: () => RentcastSettings | null;
  store: DataStore;
  now: () => Date;
  fetcher?: Fetcher;
  /** How long all the asking for one house may take. Default HOUSE_DEADLINE_MS; a test sets it to see the deadline kept. */
  deadlineMs?: number;
  /** How long the bookkeeping around one request may take on top of it. Default BOOKKEEPING_MS; a test sets it. */
  bookkeepingMs?: number;
}

/** The demo: one made-up house among made-up sales (synthetic-provider.ts). */
const synthetic = new SyntheticProvider();

async function demoHouse(ask: HouseAsk, fallback?: Fallback): Promise<HouseData> {
  const record = (await synthetic.lookup())!;
  const { sqft, lotSqft, beds, baths, yearBuilt, garage } = record;
  const recorded: RecordedFacts = { sqft, lotSqft, beds, baths, yearBuilt, garage };
  const facts: PropertyFacts = { ...record, ...overlay(recorded, ask.overrides), sqft: typeof ask.overrides.sqft === "number" ? ask.overrides.sqft : sqft };
  return { provider: "synthetic", demo: true, fallback, recorded, facts, sales: await synthetic.salesNear(facts, 2.5, 18, ask.asOf), config: DEFAULT_MARKET_CONFIG, tiers: RELAXATION_TIERS };
}

export function createHouseData(deps: HouseDataDeps): (ask: HouseAsk) => Promise<HouseData> {
  // The questions are put by the shared asker (asker.ts): the budget, what is kept, what is being asked right now.
  const asker = createAsker({ store: deps.store, now: deps.now, fetcher: deps.fetcher, bookkeepingMs: deps.bookkeepingMs });
  /** One question; a question that could not be answered becomes the reason the house gets the demo's data. */
  async function question(settings: RentcastSettings, q: Question, userId: string | null, run: Run): Promise<Answer> {
    try {
      return await asker.question(settings, q, userId, run);
    } catch (err) {
      if (err instanceof NotAnswered) throw new Unavailable(err.code, { opensAt: err.opensAt });
      throw err;
    }
  }

  /** What an answer's status means when it is not an answer: a key that is refused is ours to fix, anything else may pass. */
  const refusal = (status: number, what: string): Unavailable => {
    console.error(`[rentcast] ${what} refused`, { status });
    return new Unavailable(status === 401 || status === 403 ? "refused" : "unavailable");
  };

  async function realHouse(settings: RentcastSettings, ask: HouseAsk, run: Run): Promise<HouseData> {
    const address = ask.address ? oneLine(ask.address) : "";
    if (!address) throw new Unavailable("no-address");
    // The sold homes are read as they stand today (see the top of the file). A day either side is the same day
    // somewhere; any other date is another question, which these records cannot answer.
    const today = deps.now().toISOString().slice(0, 10);
    const daysOff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ask.asOf}T00:00:00Z`)) / DAY_MS;
    if (!(Math.abs(daysOff) <= 1)) throw new Unavailable("other-date");

    const began = performance.now();
    /** How long is left for this house, and a question's own limit inside that. Nothing is asked with under two seconds to go. */
    const timeLeft = (most: number): number => {
      const left = (deps.deadlineMs ?? HOUSE_DEADLINE_MS) - (performance.now() - began);
      if (left < 2_000) throw new Unavailable("unavailable");
      return Math.min(most, left);
    };

    // The house's own record. An answer is this house's only if its address is the address asked for
    // (address-match.ts): a service that places addresses on a map can answer with the house next door.
    // Whether RentCast ever does has not been seen; the check does not depend on it.
    const mine = (r: PropertyRecord) => sameHouseAddress(address, r.address);
    const looked = await question(
      settings,
      {
        what: "property",
        key: `${PROVIDER}:property:v4:${addressKey(address)}`,
        asWritten: `${PROVIDER}:property-as-written:v1:${address.slice(0, 300).toLowerCase()}`,
        found: (reply) => reply.records.some(mine),
        url: propertyUrl(settings.baseUrl, address),
        // An answer that holds this house's record is kept a month, for every way of writing its address. One that
        // holds another house's is kept a day, for this way of writing it alone: long enough that the same address is
        // not paid for twice in a sitting, short enough to be asked again.
        keptDays: (reply) => (reply.records.some(mine) ? PROPERTY_KEPT_DAYS : MISS_KEPT_DAYS),
        timeoutMs: timeLeft(12_000),
      },
      ask.userId,
      run,
    );
    // 404: no such record. 400: an address RentCast could not place. Neither is billed.
    if (looked.reply.status === 404 || looked.reply.status === 400) throw new Unavailable("not-found");
    if (looked.reply.status !== 200 || looked.reply.garbled) throw refusal(looked.reply.status, "property lookup");
    const record = looked.reply.records.find(mine);
    // No record at all is "not found". A record that cannot be told to be this house's is said as that, with its address.
    if (!record) throw new Unavailable(looked.reply.records.length ? "not-matched" : "not-found", { answered: looked.reply.records[0]?.address });
    if (record.propertyType && !(HOME_TYPES as readonly string[]).includes(record.propertyType)) throw new Unavailable("not-a-house", { propertyType: record.propertyType });

    const recorded: RecordedFacts = { sqft: record.sqft, lotSqft: record.lotSqft, beds: record.beds, baths: record.baths, yearBuilt: record.yearBuilt, garage: record.garage };
    const laid = overlay(recorded, ask.overrides);
    if (laid.sqft === null) throw new Unavailable("no-size");
    // The zip code is what the ceiling is drawn within. A record without one takes the zip that was asked for.
    const zip = record.zip ?? takeApart(address).zip;
    const facts: PropertyFacts = { id: record.id, lat: record.lat, lng: record.lng, submarket: zip ?? "zip not on record", ...laid, sqft: laid.sqft, condition: "average" };

    // The sold homes around it.
    const propertyType = record.propertyType ?? "Single Family";
    // The size asked for is this house's to the nearest hundred, so that a listing that says 1,840 and a record
    // that says 1,810 ask the same question; the band is widened by the fifty either side that this may be off.
    const centre = Math.round(facts.sqft / 100) * 100;
    const byId = new Map<string, PropertyRecord>();
    // Of the widest step asked and answered: was it more than one request returns, and within what radius is it whole.
    let sampled = false;
    let wholeWithinMiles: number | null = null;
    /** More matched than came back, or as many came back as one request returns and the answer does not say how many matched. */
    const cutShort = (reply: RentcastReply) => (reply.total ?? reply.returned) > reply.returned || (reply.total === null && reply.returned >= RENTCAST_PAGE);
    let searches = 0;
    /** The widest step that was asked and answered. */
    let reached = -1;
    /** When the sold homes were read: the oldest of the answers used, kept ones included. */
    let readAt: Date | null = null;

    const search = async (step: (typeof STEPS)[number], radiusMiles: number): Promise<RentcastReply> => {
      // Every search counts toward what one run may ask, whether it is answered from what was kept, by RentCast,
      // or not at all: a later run then asks the same questions and stops in the same place.
      searches++;
      // RentCast counts "sold within N days" back from today. Counted in whole months of 31 days, with a day to
      // spare, so that a run on another day of the week asks the same question.
      const days = Math.ceil((Math.round(step.months * 30.4375) + 1) / 31) * 31;
      const sqft: [number, number] = [Math.floor(((centre - 50) * (1 - step.sqftTolerance)) / 50) * 50, Math.ceil(((centre + 50) * (1 + step.sqftTolerance)) / 50) * 50];
      const key = `${PROVIDER}:sales:v3:${record.lat.toFixed(5)},${record.lng.toFixed(5)}:${propertyType}:${sqft[0]}-${sqft[1]}:${radiusMiles}:${days}`;
      const got = await question(settings, { what: "sales", key, emptyIsAnswer: true, url: salesUrl(settings.baseUrl, { lat: record.lat, lng: record.lng, radiusMiles, days, sqft, propertyType }), keptDays: () => SALES_KEPT_DAYS, timeoutMs: timeLeft(20_000) }, ask.userId, run);
      if (got.reply.status !== 404 && (got.reply.status !== 200 || got.reply.garbled)) throw refusal(got.reply.status, "sales search");
      if (readAt === null || got.readAt < readAt) readAt = got.readAt;
      // 404 is RentCast's "nothing matched": an empty answer, not a failure.
      if (got.reply.status === 404) return { status: 200, records: [], returned: 0, total: 0 };
      for (const r of got.reply.records) byId.set(r.id, r);
      return got.reply;
    };
    const sales = (): Sale[] => [...byId.values()].flatMap((r) => (r.id === record.id ? [] : (saleFrom(r) ?? [])));
    const comps = (tiers: number) => selectComps(facts, sales(), ask.asOf, REAL_SALES_CONFIG, "renovated", REAL_SALES_TIERS.slice(0, tiers)).comps.length;
    const orNothing = (err: unknown) => {
      if (!(err instanceof Unavailable)) throw err;
    };

    let enough = false;
    for (const [i, step] of STEPS.entries()) {
      // What one run may ask is asked: what was found is what there is.
      if (searches >= MAX_SEARCHES) break;
      let reply: RentcastReply;
      try {
        reply = await search(step, step.radiusMiles);
      } catch (err) {
        // A wider step that cannot be asked leaves what was found before it, if that is anything to compare with.
        // If it is not, the reason the step could not be asked is the reason there are no real prices.
        if (!(err instanceof Unavailable) || i === 0 || comps(STEPS[reached].tiers) === 0) throw err;
        break;
      }
      reached = i;
      // Records with the day of a sale and no price: a place that does not publish prices. Asking wider buys more of
      // the same. Said only where no sale read so far has a price that can be used: a few priced ones are still sales.
      const priced = reply.records.filter((r) => r.lastSale !== null).length;
      if (reply.returned >= PRICES_EXPECTED_OF && priced < reply.returned * PRICED_SHARE && sales().length === 0) throw new Unavailable("no-prices");

      sampled = cutShort(reply);
      wholeWithinMiles = null;
      if (sampled) {
        // More matched than came back, and which ones came back is anybody's guess. The nearest are asked for whole,
        // if this run may still ask. Only an answer that itself came back whole says they are all there: where homes
        // stand closer together near the house than further out, the smaller circle can hold more than a request too.
        const matched = reply.total ?? reply.returned;
        const inner = Math.max(MIN_RADIUS_MILES, Math.floor(step.radiusMiles * Math.sqrt((REFILL * RENTCAST_PAGE) / Math.max(matched, RENTCAST_PAGE + 1)) * 100) / 100);
        if (inner < step.radiusMiles && searches < MAX_SEARCHES) {
          const nearest = await search(step, inner).catch(orNothing);
          if (nearest && !cutShort(nearest)) wholeWithinMiles = inner;
        }
      }
      if (comps(step.tiers) >= REAL_SALES_CONFIG.minComps) {
        enough = true;
        break;
      }
    }

    const went = STEPS[reached];
    const usable = sales();
    const newestSale = usable.reduce<string | null>((newest, s) => (newest === null || s.saleDate > newest ? s.saleDate : newest), null);
    return {
      provider: PROVIDER,
      demo: false,
      recorded,
      facts,
      sales: usable,
      config: REAL_SALES_CONFIG,
      // The engine widens no further than the search did: sales from two and a half miles are not "comps within five".
      tiers: REAL_SALES_TIERS.slice(0, went.tiers),
      source: {
        name: "RentCast",
        record: { address: record.address, propertyType: record.propertyType, county: record.county, lastSale: record.lastSale, soldOn: record.lastSale ? null : (record.soldOn ?? null), readAt: looked.readAt.toISOString() },
        search: {
          radiusMiles: went.radiusMiles,
          months: went.months,
          found: byId.size - (byId.has(record.id) ? 1 : 0),
          usable: usable.length,
          newestSale,
          sampled,
          wholeWithinMiles,
          stoppedEarly: !enough && reached < STEPS.length - 1,
          readAt: (readAt ?? looked.readAt).toISOString(),
        },
      },
    };
  }

  return async function houseData(ask: HouseAsk): Promise<HouseData> {
    const settings = deps.rentcast();
    if (!settings) return demoHouse(ask);
    const run: Run = { over: false };
    try {
      // The caller has its answer inside the limit, whatever is still waited for underneath. A request already sent
      // is then finished, recorded and kept for the next run; nothing more is sent for this one.
      return await within(realHouse(settings, ask, run), deps.deadlineMs ?? HOUSE_DEADLINE_MS, () => new Unavailable("unavailable"));
    } catch (err) {
      run.over = true;
      if (err instanceof Unavailable) return demoHouse(ask, fallbackFor(err, ask));
      // Anything else is ours. The analysis still runs, as a demo, and the log says what kind of failure it was.
      console.error("[rentcast] failed", kind(err));
      return demoHouse(ask, fallbackFor(new Unavailable("unavailable"), ask));
    }
  };
}
