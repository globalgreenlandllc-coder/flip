import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAnalyzeHandler, recordDiffers, type AnalyzeDeps } from "./analyze.ts";
import { createEvaluateHandler, type EvaluateDeps } from "./evaluate.ts";
import { InputError, readListing, readPhotos } from "./inputs.ts";
import { demoProviders } from "../data/index.ts";
import { MemoryDataStore, type DataBudget } from "../data/budget.ts";
import { createHouseData, type DataSource, type HouseAsk, type RentcastSettings } from "../data/house-data.ts";
import type { Fetcher } from "../data/rentcast.ts";
import { SUBJECT_ADDRESS, fakeRentcast, soldHomes, subjectRecord } from "../data/rentcast-fixtures.mts";
import { DEFAULT_DEAL_TERMS } from "../engine/index.ts";
import { DEFAULT_LIMITS, MemoryUsageStore, usageSummary, type UsageLimits, type UsageStore } from "../usage/limits.ts";
import { PhotoReadError, tidyAssessment, type PhotoContext, type PhotoInput, type PhotoReading } from "../vision/analyze-photos.ts";
import type { PhotoAssessment } from "../vision/schema.ts";
import type { Report } from "../engine/types.ts";
import type { ListingInfo } from "../listing/fetch-listing.ts";

/** The fields a reply can carry; each test reads the ones its case returns. */
interface Reply {
  error: string;
  limit: string;
  provider: string;
  demo: boolean;
  untested: boolean;
  fallback: { code: string; message: string };
  data: DataSource;
  warning: string;
  usage: { used: number; limit: number; resetsOn: string };
  report: Report;
  plan: { totals: { costLikely: number } };
  listing: ListingInfo;
  blocked: boolean;
  subjectSources: Record<string, string>;
  photosUsed: { uploaded: number; fromListing: number; failed: number; leftOut: number };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]).toString("base64");
const TEXT = Buffer.from("just some text, not an image at all").toString("base64");

const ASSESSMENT: PhotoAssessment = {
  overallCondition: "dated",
  summary: "Dated but solid.",
  rooms: [{ room: "kitchen", label: "Kitchen", condition: 2, finishLevel: "dated", issues: ["oak cabinets"], keep: ["layout"], photoIndexes: [1] }],
  categoryNeeds: { kitchen: "replace", baths: "refresh", flooring: "refresh", paint: "refresh", exterior: "none", landscaping: "none", windows: "none", roof: "unknown", electrical: "unknown", plumbing: "unknown", hvac: "unknown", basement: "none" },
  redFlags: ["water stain on the hall ceiling"],
  unknowns: ["roof age"],
};

/** A handler wired to stand-ins, and a record of what it asked of them. */
function rig(
  over: {
    limits?: Partial<UsageLimits>;
    userId?: string | null;
    usage?: UsageStore;
    readPhotos?: AnalyzeDeps["readPhotos"];
    fetchListing?: AnalyzeDeps["fetchListing"];
    fetchPhotos?: AnalyzeDeps["fetchPhotos"];
    resolveByAddress?: AnalyzeDeps["resolveByAddress"];
    /** RentCast as connected (a key and a budget), with `rentcastFetch` standing in for its API. Left out: not connected, the demo. */
    rentcast?: RentcastSettings;
    rentcastFetch?: Fetcher;
  } = {},
) {
  const store = new MemoryUsageStore();
  const data = new MemoryDataStore();
  const seen = { ai: [] as PhotoInput[][], told: [] as PhotoContext[], listings: [] as string[], photoFetches: [] as string[][], houses: [] as HouseAsk[], resolved: [] as string[] };
  const clock = { now: new Date("2026-11-10T10:00:00.000Z"), user: over.userId === undefined ? "ann" : over.userId };
  const realHouse = createHouseData({ rentcast: () => over.rentcast ?? null, store: data, now: () => clock.now, fetcher: over.rentcastFetch });
  const house = (ask: HouseAsk) => {
    seen.houses.push(ask);
    return realHouse(ask);
  };
  const deps: AnalyzeDeps & EvaluateDeps = {
    userId: async () => clock.user,
    usage: over.usage ?? store,
    limits: () => ({ ...DEFAULT_LIMITS, ...over.limits }),
    now: () => clock.now,
    providers: demoProviders,
    houseData: (ask) => house(ask),
    fetchListing: async (url) => {
      seen.listings.push(url);
      return over.fetchListing ? over.fetchListing(url) : { url, host: new URL(url).hostname, fetched: false, note: "blocked", photos: [] };
    },
    resolveByAddress: async (address, blockedHost) => {
      seen.resolved.push(address);
      return over.resolveByAddress ? over.resolveByAddress(address, blockedHost) : null;
    },
    fetchPhotos: async (urls) => {
      seen.photoFetches.push(urls);
      return over.fetchPhotos ? over.fetchPhotos(urls) : { photos: [], failed: urls };
    },
    readPhotos:
      over.readPhotos ??
      (async (photos, context): Promise<PhotoReading> => {
        seen.ai.push(photos);
        seen.told.push(context);
        return { assessment: ASSESSMENT, model: "claude-test", inputTokens: 21_000, outputTokens: 1_800 };
      }),
  };
  const post = (handler: (req: Request) => Promise<Response>) => async (body: unknown) => {
    const res = await handler(new Request("http://flip.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { status: res.status, retryAfter: res.headers.get("retry-after"), body: (await res.json()) as Reply };
  };
  return { store, data, seen, clock, deps, analyze: post(createAnalyzeHandler(deps)), evaluate: post(createEvaluateHandler(deps)) };
}

const HOUSE = { photos: [{ base64: JPEG, mediaType: "image/jpeg" }], deal: { askingPrice: 640_000 } };
const DEFAULT_TARGET = DEFAULT_DEAL_TERMS.targetProfit;

/** A store whose database is down. */
const BROKEN_STORE: UsageStore = {
  start: async () => {
    throw new Error("db down");
  },
  counts: async () => ({ month: 0, windowPaid: 0, windowAll: 0, dayAll: 0 }),
  monthUsed: async () => 0,
  finish: async () => {},
  discard: async () => {},
};

test("analyze: a signed-out caller gets 401 and nothing is recorded", async () => {
  const r = rig({ userId: null });
  const res = await r.analyze(HOUSE);
  assert.equal(res.status, 401);
  assert.equal(r.store.runs.length, 0);
  assert.equal(r.seen.ai.length, 0);
});

test("analyze: a good request is analysed, marked as a demo, and the run is recorded with what it cost", async () => {
  const r = rig();
  r.deps.now = () => r.clock.now;
  const res = await r.analyze(HOUSE);
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, "synthetic");
  assert.equal(res.body.demo, true);
  assert.match(res.body.warning, /^Demo numbers\./);
  assert.ok(["GO", "TIGHT", "PASS"].includes(res.body.report.deal.verdict));
  assert.equal(res.body.report.deal.purchasePrice, 640_000);
  assert.deepEqual(res.body.usage, { used: 1, limit: DEFAULT_LIMITS.monthlyAnalyses, resetsOn: "2026-12-01" });
  assert.equal(r.seen.ai.length, 1);
  assert.equal(r.seen.ai[0].length, 1);
  assert.equal(r.store.runs.length, 1);
  const run = r.store.runs[0];
  assert.equal(run.userId, "ann");
  assert.equal(run.kind, "analyze");
  assert.deepEqual({ ...run.outcome, ms: undefined }, { status: "ok", photos: 1, model: "claude-test", inputTokens: 21_000, outputTokens: 1_800, ms: undefined });
});

test("analyze: a request that is not well-formed is refused before a run is started or anything is fetched", async () => {
  const r = rig();
  const cases: [unknown, RegExp][] = [
    ["{not json", /Body must be JSON/],
    [[1, 2], /Body must be a JSON object/],
    [{ ...HOUSE, photos: [{ base64: TEXT, mediaType: "image/jpeg" }] }, /Photo 1 is not a JPEG, PNG, WebP or GIF image/],
    [{ ...HOUSE, photos: [{ base64: JPEG, mediaType: "application/pdf" }] }, /Photo 1 must be a JPEG, PNG, WebP or GIF image/],
    [{ ...HOUSE, photos: "nope" }, /`photos` must be a list/],
    [{ ...HOUSE, deal: { askingPrice: "640000" } }, /Asking price must be a number/],
    [{ ...HOUSE, deal: { askingPrice: -5 } }, /Asking price must be above 0/],
    [{ ...HOUSE, deal: { askingPrice: 640_000, holdingMonths: 900 } }, /Hold \(months\) cannot be above 60/],
    [{ ...HOUSE, deal: { askingPrice: 640_000, financing: { rate: 11 } } }, /Loan rate cannot be above 1/],
    [{ ...HOUSE, asOf: "next tuesday" }, /Dates are written YYYY-MM-DD/],
    [{ ...HOUSE, listingUrl: "http://169.254.169.254/latest/meta-data/" }, /That listing link cannot be read/],
    [{ ...HOUSE, listingUrl: "http://localhost:3000/admin" }, /That listing link cannot be read/],
    [{ ...HOUSE, listingUrl: "file:///etc/passwd" }, /That listing link cannot be read/],
    [{ ...HOUSE, listing: { url: "not a link", photos: [] } }, /`listing.url` must be the listing's web address/],
    [{ ...HOUSE, listing: "https://www.zillow.com/homedetails/x/1_zpid/" }, /`listing` must be an object/],
  ];
  for (const [body, message] of cases) {
    const res = await r.analyze(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.match(res.body.error, message);
  }
  assert.equal(r.store.runs.length, 0);
  assert.equal(r.seen.ai.length, 0);
  assert.equal(r.seen.listings.length, 0);
  assert.equal(r.seen.photoFetches.length, 0);
});

test("analyze: location, id and condition cannot be set by the caller", async () => {
  const r = rig();
  const res = await r.analyze({ ...HOUSE, subject: { sqft: 2_000, lat: 1, lng: 2, id: "mine", condition: "renovated", submarket: "Elsewhere" } });
  assert.equal(res.status, 200);
  const base = await demoProviders().parcels.lookup("demo");
  assert.equal(res.body.report.subject.sqft, 2_000);
  assert.equal(res.body.report.subject.lat, base!.lat);
  assert.equal(res.body.report.subject.id, base!.id);
  assert.equal(res.body.report.subject.submarket, base!.submarket);
  // Condition comes from the photos.
  assert.equal(res.body.report.subject.condition, "dated");
});

test("analyze: what a parser read off a page is kept when sane and left out when not, never thrown back at the person", async () => {
  const r = rig();
  const base = await demoProviders().parcels.lookup("demo");
  // A lot size mistaken for the living area, a bedroom count that is not a number.
  const odd = await r.analyze({ ...HOUSE, subject: { sqft: 87_120, beds: "three", baths: 2.5 } });
  assert.equal(odd.status, 200);
  assert.equal(odd.body.report.subject.sqft, base!.sqft);
  assert.equal(odd.body.report.subject.beds, base!.beds);
  assert.equal(odd.body.report.subject.baths, 2.5);

  // A listing the browser read: an endless title, a silly price, a photo "link" that is not one.
  const listing = { url: "https://www.zillow.com/homedetails/1-Main-St-Graham-WA-98338/1_zpid/", fetched: true, title: "x".repeat(5_000), address: "1 Main St, Graham, WA 98338", price: -1, beds: 3, sqft: 12, photos: ["javascript:alert(1)", 42] };
  const res = await r.analyze({ listing, photos: HOUSE.photos, deal: { askingPrice: 640_000 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.listing.title?.length, 500);
  assert.equal(res.body.listing.price, undefined);
  assert.equal(res.body.listing.beds, 3);
  assert.equal(res.body.listing.sqft, undefined);
  assert.deepEqual(res.body.listing.photos, []);
  assert.equal(res.body.listing.host, "zillow.com");
  assert.equal(res.body.report.subject.beds, 3);
  // The server did not go and read the page itself: the browser already had.
  assert.equal(r.seen.listings.length, 0);
});

test("analyze: the monthly allowance stops the AI from being asked again", async () => {
  const r = rig({ limits: { monthlyAnalyses: 2, analysesPerWindow: 99 } });
  assert.equal((await r.analyze(HOUSE)).status, 200);
  assert.equal((await r.analyze(HOUSE)).body.usage.used, 2);
  const third = await r.analyze(HOUSE);
  assert.equal(third.status, 429);
  assert.equal(third.body.limit, "monthly");
  assert.match(third.body.error, /You have used all 2 analyses for this month/);
  assert.deepEqual(third.body.usage, { used: 2, limit: 2, resetsOn: "2026-12-01" });
  assert.ok(Number(third.retryAfter) > 86_400);
  assert.equal(r.seen.ai.length, 2);
  // Turned away, it left no row behind.
  assert.equal(r.store.runs.length, 2);
  // A new month, a new allowance.
  r.clock.now = new Date("2026-12-01T00:00:05.000Z");
  assert.equal((await r.analyze(HOUSE)).status, 200);
});

test("analyze: one person cannot run analyses faster than the short window allows", async () => {
  const r = rig({ limits: { analysesPerWindow: 2 } });
  assert.equal((await r.analyze(HOUSE)).status, 200);
  assert.equal((await r.analyze(HOUSE)).status, 200);
  const fast = await r.analyze(HOUSE);
  assert.equal(fast.status, 429);
  assert.equal(fast.body.limit, "window");
  assert.equal(fast.retryAfter, "600");
  // Turned away, it is not one of theirs: the month still reads two.
  assert.equal(fast.body.usage.used, 2);
  assert.equal(r.seen.ai.length, 2);
  r.clock.now = new Date(r.clock.now.getTime() + 11 * 60_000);
  assert.equal((await r.analyze(HOUSE)).status, 200);
});

test("analyze: everyone together stops at the daily ceiling, whoever asks", async () => {
  const r = rig({ limits: { dailyAnalysesAll: 2 } });
  assert.equal((await r.analyze(HOUSE)).status, 200);
  r.clock.user = "bob";
  assert.equal((await r.analyze(HOUSE)).status, 200);
  r.clock.user = "cy";
  const res = await r.analyze(HOUSE);
  assert.equal(res.status, 429);
  assert.equal(res.body.limit, "daily");
  assert.equal(r.seen.ai.length, 2);
});

test("analyze: an attempt that ends before the AI is asked costs the person nothing", async () => {
  const r = rig();
  // A blocked listing and no photos: nothing to look at.
  const blocked = await r.analyze({ listingUrl: "https://www.zillow.com/homedetails/1-Main-St-Graham-WA-98338/1_zpid/" });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /would not let us read the page/);
  assert.deepEqual(r.seen.listings, ["https://www.zillow.com/homedetails/1-Main-St-Graham-WA-98338/1_zpid/"]);
  // Photos but no price.
  const noPrice = await r.analyze({ photos: HOUSE.photos });
  assert.equal(noPrice.status, 400);
  assert.match(noPrice.body.error, /Enter the asking price/);
  assert.deepEqual(r.store.runs.map((x) => x.outcome.status), ["free", "free"]);
  assert.equal(r.store.runs[0].source, "zillow.com");
  assert.equal(r.seen.ai.length, 0);
  assert.equal((await usageSummary(r.store, DEFAULT_LIMITS, "ann", r.clock.now)).used, 0);
});

test("analyze: an answer that was generated and then unusable counts; a service that never answered does not", async () => {
  const cutOff = rig({ readPhotos: async () => { throw new PhotoReadError("Assessment was cut off. Try fewer photos.", true); } });
  const a = await cutOff.analyze(HOUSE);
  assert.equal(a.status, 502);
  assert.equal(a.body.error, "Photo analysis failed: Assessment was cut off. Try fewer photos.");
  assert.equal(cutOff.store.runs[0].outcome.status, "failed");
  assert.equal((await usageSummary(cutOff.store, DEFAULT_LIMITS, "ann", cutOff.clock.now)).used, 1);

  const down = rig({ readPhotos: async () => { throw new PhotoReadError("The photo reading service did not answer. Try again in a minute.", false, new Error('401 {"error":{"message":"invalid x-api-key sk-secret"}}')); } });
  const b = await down.analyze(HOUSE);
  assert.equal(b.status, 502);
  // The service's own words stay in the log.
  assert.doesNotMatch(JSON.stringify(b.body), /x-api-key|sk-secret|401/);
  assert.equal(down.store.runs[0].outcome.status, "free");
  assert.equal((await usageSummary(down.store, DEFAULT_LIMITS, "ann", down.clock.now)).used, 0);

  const odd = rig({ readPhotos: async () => { throw new Error("socket hang up at 10.0.0.12"); } });
  const c = await odd.analyze(HOUSE);
  assert.equal(c.status, 502);
  assert.doesNotMatch(JSON.stringify(c.body), /10\.0\.0\.12/);
  assert.equal(odd.store.runs[0].outcome.status, "failed");
});

test("analyze: when usage cannot be counted, the AI is not asked", async () => {
  const r = rig({ usage: BROKEN_STORE });
  const res = await r.analyze(HOUSE);
  assert.equal(res.status, 503);
  assert.match(res.body.error, /could not check your usage/);
  assert.equal(r.seen.ai.length, 0);
});

test("analyze: a database that fails between writing the run down and counting it costs nobody anything", async () => {
  const r = rig({ limits: { monthlyAnalyses: 5 } });
  const counts = r.store.counts.bind(r.store);
  r.store.counts = async () => {
    throw new Error("db hiccup");
  };
  for (let i = 0; i < 6; i++) assert.equal((await r.analyze(HOUSE)).status, 503);
  r.store.counts = counts;
  // Six "try again in a minute" answers later, trying again works, and the month is untouched.
  const res = await r.analyze(HOUSE);
  assert.equal(res.status, 200);
  assert.equal(res.body.usage.used, 1);
  assert.equal(r.seen.ai.length, 1);
});

test("analyze: while the property record is made up, the AI is told only what the listing gave", async () => {
  const r = rig();
  const told = (i: number) => Object.fromEntries(Object.entries(r.seen.told[i]).filter(([, v]) => v !== undefined));
  await r.analyze(HOUSE);
  // Nothing from the made-up record: no year, no neighbourhood, no size.
  assert.deepEqual(told(0), {});
  const listing = { url: "https://www.zillow.com/homedetails/1-Main-St-Graham-WA-98338/1_zpid/", fetched: true, address: "1 Main St, Graham, WA 98338", sqft: 2_150, beds: 4, photos: [], facts: { yearBuilt: { value: 1987, source: "data" } } };
  await r.analyze({ ...HOUSE, listing, subject: { baths: 2.5 } });
  assert.deepEqual(told(1), { address: "1 Main St, Graham, WA 98338", sqft: 2_150, beds: 4, baths: 2.5, yearBuilt: 1987 });
});

/** A listing as a browser reads it off a page: description, facts with their sources, detail lines. Written by hand. */
const READ_LISTING = {
  url: "https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/1_zpid/",
  fetched: true,
  address: "13013 224th St E, Graham, WA 98338",
  price: 549_000,
  beds: 4,
  baths: 3,
  sqft: 2_340,
  photos: [] as string[],
  description: { text: "Sold as-is. Cash or rehab loan only: the septic system failed inspection in 2025.", source: "data" },
  facts: {
    yearBuilt: { value: 1955, source: "data" },
    lotSqft: { value: 44_431, source: "data" },
    garage: { value: 2, source: "text", seen: "Garage spaces: 2" },
    hoaMonthly: { value: 35, source: "text", seen: "HOA dues: $35/mo" },
    mlsId: { value: "2301234", source: "meta" },
  },
  details: [{ label: "Sewer", value: "Septic Tank" }, { label: "Listing terms", value: "Cash, Rehab Loan" }],
  // Five minutes before the clock of these tests.
  read: { at: "2026-11-10T09:55:00.000Z", via: "paste" },
};

test("analyze: what the listing said is kept and comes back with the result", async () => {
  const r = rig();
  const res = await r.analyze({ photos: HOUSE.photos, listing: READ_LISTING });
  assert.equal(res.status, 200);
  // The asking price came from the listing; nobody typed it.
  assert.equal(res.body.report.deal.purchasePrice, 549_000);
  assert.deepEqual(res.body.listing.description, READ_LISTING.description);
  assert.deepEqual(res.body.listing.details, READ_LISTING.details);
  assert.deepEqual(res.body.listing.facts, READ_LISTING.facts);
  assert.deepEqual(res.body.listing.read, READ_LISTING.read);
  assert.equal(r.store.runs[0].source, "zillow.com");
  // With photos beside it, the server did not read the link itself.
  assert.equal(r.seen.listings.length, 0);
});

test("analyze: the house's facts come from the listing where it gives them, and the result says which came from where", async () => {
  const r = rig();
  const base = await demoProviders().parcels.lookup("demo");
  const res = await r.analyze({ photos: HOUSE.photos, listing: READ_LISTING });
  const { subject } = res.body.report;
  // Size, rooms and year from the listing. Its lot and garage are kept and shown, and are not yet the valuation's to use.
  assert.deepEqual([subject.sqft, subject.beds, subject.baths, subject.yearBuilt, subject.lotSqft, subject.garage], [2_340, 4, 3, 1955, base!.lotSqft, base!.garage]);
  assert.deepEqual(res.body.subjectSources, { sqft: "listing", lotSqft: "record", beds: "listing", baths: "listing", yearBuilt: "listing", garage: "record" });
  assert.deepEqual([res.body.listing.facts?.lotSqft?.value, res.body.listing.facts?.garage?.value], [44_431, 2]);
  // Where the house is still comes from the (made-up) record.
  assert.deepEqual([subject.lat, subject.submarket], [base!.lat, base!.submarket]);

  // The age flags follow the year built: read off the listing here, so they are not demo flags.
  const basis = (code: string) => res.body.report.riskFlags.filter((f) => f.code === code).map((f) => f.basis);
  assert.deepEqual(basis("PRE_1978"), ["listing"]);
  assert.deepEqual(basis("OLD_SYSTEMS"), ["listing"]);
  assert.deepEqual(basis("PHOTO_RED_FLAG"), ["photos"]);
  assert.deepEqual(basis("VERIFY_ON_SITE"), ["photos"]);
  assert.ok(res.body.report.riskFlags.filter((f) => !["PRE_1978", "OLD_SYSTEMS", "PHOTO_RED_FLAG", "VERIFY_ON_SITE"].includes(f.code)).every((f) => f.basis === "sales"));

  // With nothing from a listing, everything is the record's, the age flags included.
  const bare = await r.analyze(HOUSE);
  assert.deepEqual(bare.body.subjectSources, { sqft: "record", lotSqft: "record", beds: "record", baths: "record", yearBuilt: "record", garage: "record" });
  assert.deepEqual(bare.body.report.riskFlags.filter((f) => f.code === "PRE_1978").map((f) => f.basis), ["record"]);
  // What the caller sends wins over the listing, and is said to be the caller's.
  const corrected = await r.analyze({ photos: HOUSE.photos, listing: READ_LISTING, subject: { yearBuilt: 1999 } });
  assert.equal(corrected.body.report.subject.yearBuilt, 1999);
  assert.equal(corrected.body.subjectSources.yearBuilt, "caller");
  assert.equal(corrected.body.report.riskFlags.some((f) => f.code === "PRE_1978"), false);
  // ...its age flags included: a year the caller sent is not "from the listing".
  const old = await r.analyze({ ...HOUSE, subject: { yearBuilt: 1950 } });
  assert.deepEqual(old.body.report.riskFlags.filter((f) => f.code === "PRE_1978" || f.code === "OLD_SYSTEMS").map((f) => f.basis), ["caller", "caller"]);
});

test("analyze: a year found in a sentence is kept with the listing and is not the house's", async () => {
  const r = rig();
  const loose = { ...READ_LISTING, facts: { yearBuilt: { value: 2019, source: "text", seen: "Detached shop built in 2019", loose: true } } };
  const res = await r.analyze({ photos: HOUSE.photos, listing: loose });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.listing.facts?.yearBuilt, loose.facts.yearBuilt);
  assert.equal(res.body.subjectSources.yearBuilt, "record");
  assert.notEqual(res.body.report.subject.yearBuilt, 2019);
  // And the AI is not told a year nobody stated.
  assert.equal(r.seen.told[0].yearBuilt, undefined);
});

test("analyze: one house per request: a reading of one page is not taken with the link of another", async () => {
  const r = rig();
  const other = await r.analyze({ listingUrl: "https://b.example/other-house", listing: READ_LISTING });
  assert.equal(other.status, 400);
  assert.match(other.body.error, /two different pages/);
  // Refused before a run is started or anything is read.
  assert.equal(r.store.runs.length, 0);
  assert.equal(r.seen.listings.length, 0);
  // The same page with something added to its link on the way is the same page.
  const shared = await r.analyze({ ...HOUSE, listingUrl: `${READ_LISTING.url}?utm_source=share`, listing: READ_LISTING });
  assert.equal(shared.status, 200);
});

test("analyze: a page the browser read and a link that turns out to be another house are not made into one listing", async () => {
  const photo: PhotoInput = { base64: JPEG, mediaType: "image/jpeg" };
  // A link that does not say its address; the server reads it and finds 9 Other Rd. The page that was pasted is 13013 224th St E.
  const r = rig({
    fetchListing: async (url) => ({ url, host: "windfall.example", fetched: true, address: "9 Other Rd, Tacoma, WA 98402", price: 310_000, photos: ["https://photos.example.com/other/1.jpg"], read: { at: "2026-11-10T09:59:00.000Z", via: "server" } }),
    fetchPhotos: async (urls) => ({ photos: urls.map(() => photo), failed: [] }),
  });
  const link = "https://www.windfall.example/listing/2301234";
  const res = await r.analyze({ listingUrl: link, listing: { ...READ_LISTING, url: link } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /page that was read is for 13013 224th St E, Graham, WA 98338, and the link is for 9 Other Rd, Tacoma, WA 98402/);
  // The other house's photos were not fetched, the AI was not asked, and it cost nothing.
  assert.deepEqual([r.seen.photoFetches.length, r.seen.ai.length, r.store.runs[0].outcome.status], [0, 0, "free"]);
  // The same house read both ways is one listing.
  const same = rig({
    fetchListing: async (url) => ({ url, host: "windfall.example", fetched: true, address: "13013 224th St E Graham, WA 98338", photos: ["https://photos.example.com/p/1.jpg"], read: { at: "2026-11-10T09:59:00.000Z", via: "server" } }),
    fetchPhotos: async (urls) => ({ photos: urls.map(() => photo), failed: [] }),
  });
  assert.equal((await same.analyze({ listingUrl: link, listing: { ...READ_LISTING, url: link } })).status, 200);
});

test("analyze: a house nothing can be compared to ends before the AI is asked, and costs nothing", async () => {
  const r = rig();
  // Forty acres: every sold home nearby is too different to be a comp.
  const res = await r.analyze({ ...HOUSE, subject: { lotSqft: 1_742_400 } });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /No usable comps/);
  assert.equal(r.seen.ai.length, 0);
  assert.equal(r.store.runs[0].outcome.status, "free");
  assert.equal((await usageSummary(r.store, DEFAULT_LIMITS, "ann", r.clock.now)).used, 0);
});

test("analyze: when the site turns the server away, that is said even if the person's browser had read the page", async () => {
  const r = rig();
  // A page pasted as text only (no photos came through), and a link the server is blocked on.
  const res = await r.analyze({ listingUrl: READ_LISTING.url, listing: READ_LISTING });
  assert.equal(res.status, 400);
  assert.equal(res.body.blocked, true);
  assert.match(res.body.error, /zillow\.com would not let us read the page for 13013 224th St E/);
  // What the browser read is not lost with it.
  assert.equal(res.body.listing.description?.text, READ_LISTING.description.text);
  // With no link at all there was nobody to be turned away.
  const none = await r.analyze({ listing: READ_LISTING });
  assert.equal(none.status, 400);
  assert.equal(none.body.blocked, false);
  assert.match(none.body.error, /No photos/);
});

test("analyze: a listing's reading is kept when sane and left out when not, field by field", async () => {
  const r = rig();
  const listing = {
    ...READ_LISTING,
    description: { text: "d".repeat(9_000), source: "data" },
    facts: {
      yearBuilt: { value: 3000, source: "data" },
      lotSqft: { value: "big", source: "data" },
      garage: { value: 2, source: "a hunch" },
      hoaMonthly: { value: 35, source: "text", seen: "s".repeat(500) },
      favoriteColor: { value: "blue", source: "text" },
      status: { value: "x".repeat(500), source: "text" },
    },
    details: [{ label: "Sewer", value: "v".repeat(500) }, { label: 7, value: "x" }, "nonsense", { label: "Roof" }],
    read: { at: "not a date", via: "server" },
  };
  const res = await r.analyze({ photos: HOUSE.photos, listing });
  assert.equal(res.status, 200);
  const kept = res.body.listing;
  assert.equal(kept.description?.text.length, 6_000);
  assert.deepEqual(Object.keys(kept.facts ?? {}).sort(), ["hoaMonthly", "status"]);
  assert.equal(kept.facts?.hoaMonthly?.seen?.length, 120);
  assert.equal(String(kept.facts?.status?.value).length, 160);
  assert.deepEqual(kept.details, [{ label: "Sewer", value: "v".repeat(160) }]);
  // Only the server's own read is "server"; a caller cannot claim it.
  assert.equal(kept.read, undefined);
  // When the browser read the page is believed only if it can be so: a full timestamp from the last week, not ahead of the clock.
  const now = r.clock.now;
  const at = (claimed: unknown) => readListing({ url: "", photos: [], read: { at: claimed, via: "paste" } }, 16, now).read?.at;
  assert.equal(at("2026-11-10T09:00:00.000Z"), "2026-11-10T09:00:00.000Z");
  assert.equal(at("2026-11-10T23:00:00+14:00"), "2026-11-10T09:00:00.000Z");
  for (const claimed of ["2099-01-01T00:00:00.000Z", "2026-11-10T10:30:00.000Z", "2020-01-01T00:00:00.000Z", "2026-11-09", "1", "0", "Tue", "Jan 1 2026 garbage", "+275760-09-13T00:00:00.000Z", 5, null]) assert.equal(at(claimed), now.toISOString(), String(claimed));
  // The other ways it was read are kept when they are ways a browser reads; "server" cannot be claimed there either.
  assert.deepEqual(readListing({ url: "", photos: [], read: { at: "x", via: "paste", with: ["browser", "server", "paste", "browser", "nonsense"] } }, 16, now).read, { at: now.toISOString(), via: "paste", with: ["browser"] });
  // A description is told to be cut when it was; the two flags a reader sets are kept, and nothing else rides along.
  assert.deepEqual(readListing({ url: "", photos: [], description: { text: "d".repeat(9_000), source: "data", unsure: true, extra: "x" } }, 16, now).description, { text: "d".repeat(6_000), source: "data", cut: true, unsure: true });
  assert.deepEqual(readListing({ url: "", photos: [], facts: { yearBuilt: { value: 1987, source: "text", loose: true, extra: 1 } } }, 16, now).facts, { yearBuilt: { value: 1987, source: "text", loose: true } });
  // The year was nonsense, so the record's stands, and is said to be the record's.
  assert.equal(res.body.subjectSources.yearBuilt, "record");
  // A description with no known source is not kept either.
  const unsourced = await r.analyze({ photos: HOUSE.photos, listing: { ...READ_LISTING, description: { text: "As-is.", source: "somewhere" } } });
  assert.equal(unsourced.body.listing.description, undefined);
});

test("analyze: a page pasted without a link is a listing too", async () => {
  const r = rig();
  const res = await r.analyze({ photos: HOUSE.photos, listing: { ...READ_LISTING, url: "" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.listing.url, "");
  assert.equal(res.body.listing.host, "");
  assert.equal(res.body.listing.description?.text, READ_LISTING.description.text);
  assert.equal(r.store.runs[0].source, null);
});

test("analyze: a browser's reading that came without photos has the server read the link for them, and keeps the browser's facts", async () => {
  const photo: PhotoInput = { base64: JPEG, mediaType: "image/jpeg" };
  const r = rig({
    fetchListing: async (url) => ({ url, host: "zillow.com", fetched: true, price: 555_000, beds: 9, photos: ["https://photos.example.com/p/1.jpg"], facts: { taxAnnual: { value: 5_432, source: "meta" } }, read: { at: "2026-11-24T20:01:00.000Z", via: "server" } }),
    fetchPhotos: async (urls) => ({ photos: urls.map(() => photo), failed: [] }),
  });
  const res = await r.analyze({ listingUrl: READ_LISTING.url, listing: READ_LISTING });
  assert.equal(res.status, 200);
  assert.deepEqual(r.seen.listings, [READ_LISTING.url]);
  assert.deepEqual(r.seen.photoFetches, [["https://photos.example.com/p/1.jpg"]]);
  const kept = res.body.listing;
  assert.equal(kept.description?.text, READ_LISTING.description.text);
  // The page the person's browser read said 4 bedrooms and $549,000; the server's read said otherwise and loses.
  assert.deepEqual([kept.beds, kept.price], [4, 549_000]);
  assert.equal(kept.facts?.taxAnnual?.value, 5_432);
  // Both ways it was read are said: the page the person pasted, and the server for what that lacked.
  assert.deepEqual(kept.read, { ...READ_LISTING.read, with: ["server"] });
  assert.deepEqual(kept.photos, ["https://photos.example.com/p/1.jpg"]);
  // The line a person reads and the fact beside it are one reading: never the browser's number in one and the server's in the other.
  const factsOnly = await r.analyze({ listingUrl: READ_LISTING.url, listing: { url: READ_LISTING.url, fetched: true, photos: [], facts: { beds: { value: 4, source: "data" }, price: { value: 549_000, source: "data" } } } });
  assert.deepEqual([factsOnly.body.listing.beds, factsOnly.body.listing.facts?.beds?.value, factsOnly.body.listing.price], [4, 4, 549_000]);
  assert.equal(factsOnly.body.report.subject.beds, 4);
});

test("analyze: a photo link that is not a link is left out, not thrown back; one with a space in it is still a link", async () => {
  const r = rig();
  // Collected off a page by a parser: one has a space in it, one is not a link at all, one is longer than any link.
  const res = await r.analyze({ ...HOUSE, photos: [...HOUSE.photos, { url: "https://cdn.example.com/Front Porch.jpg" }, { url: "javascript:alert(1)" }, { url: `https://cdn.example.com/${"a".repeat(3_000)}.jpg` }] });
  assert.equal(res.status, 200);
  assert.deepEqual(r.seen.photoFetches, [["https://cdn.example.com/Front%20Porch.jpg"]]);
  // The same for a listing the browser read: a space in its own link does not stop the analysis.
  const spaced = await r.analyze({ ...HOUSE, listing: { url: "https://www.zillow.com/homedetails/1 Main St-Graham-WA-98338/1_zpid/", fetched: true, photos: ["https://cdn.example.com/a b.jpg", "ftp://cdn.example.com/c.jpg"] } });
  assert.equal(spaced.status, 200);
  assert.deepEqual(spaced.body.listing.photos, ["https://cdn.example.com/a%20b.jpg"]);
  // With nothing else to look at, it is simply an analysis with no photos.
  const none = await r.analyze({ deal: HOUSE.deal, photos: [{ url: "javascript:alert(1)" }] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /No photos/);
});

test("a listing's lists are cut to a listing's size before anything looks at their entries", () => {
  // Building two lists of a million entries takes longer than reading them should: only the reading is timed.
  const sent = { url: "", photos: Array.from({ length: 1_000_000 }, (_, i) => `https://a.example/p ${i}.jpg`), details: Array.from({ length: 1_000_000 }, (_, i) => ({ label: "Sewer", value: `b${i}` })) };
  const started = process.hrtime.bigint();
  const big = readListing(sent, 16);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 250);
  assert.equal(big.photos.length, 16);
  assert.equal(big.details?.length, 40);
  // Names every object has are not facts, whatever is sent under them.
  const odd = readListing(JSON.parse('{"url":"","photos":[],"facts":{"__proto__":{"value":1987,"source":"data"},"constructor":{"value":1,"source":"data"},"toString":{"value":2,"source":"data"}}}'), 16);
  assert.equal(odd.facts, undefined);
  assert.equal(({} as Record<string, unknown>).value, undefined);
  // Detail lines keep flip's own labels, written flip's way; a caller's own headings, and characters that are not text, are not kept.
  const lines = readListing({ url: "", photos: [], details: [{ label: "sewer:", value: "Septic\u0000 Tank\u202e" }, { label: "__proto__", value: "x" }, { label: "<b>My heading</b>", value: "y" }] }, 16);
  assert.deepEqual(lines.details, [{ label: "Sewer", value: "Septic Tank" }]);
});

test("analyze: photos are added until the AI's request would be too large; the rest are left out and counted", async () => {
  const r = rig();
  const big = JPEG.slice(0, 24) + "A".repeat(6_000_000 - 24);
  const res = await r.analyze({ deal: HOUSE.deal, photos: Array.from({ length: 5 }, () => ({ base64: big, mediaType: "image/jpeg" })) });
  assert.equal(res.status, 200);
  assert.equal(r.seen.ai[0].length, 4);
  assert.deepEqual(res.body.photosUsed, { uploaded: 4, fromListing: 0, failed: 0, leftOut: 1 });
});

test("uploads: the file decides its type, not its label", () => {
  assert.deepEqual(readPhotos([{ base64: PNG, mediaType: "image/jpeg" }]), [{ base64: PNG, mediaType: "image/png" }]);
  assert.deepEqual(readPhotos([{ url: " https://photos.example.com/1.jpg " }, { url: "not a link" }, { url: "file:///etc/passwd" }, { url: 7 }]), [{ url: "https://photos.example.com/1.jpg" }]);
  assert.deepEqual(readPhotos(undefined), []);
  assert.throws(() => readPhotos(Array.from({ length: 61 }, () => ({ url: "https://photos.example.com/1.jpg" }))), InputError);
  assert.throws(() => readPhotos([{ base64: "A".repeat(6_200_001), mediaType: "image/jpeg" }]), /Photo 1 is too large/);
  assert.throws(() => readPhotos([{ base64: `${JPEG}<script>`, mediaType: "image/jpeg" }]), /Photo 1 could not be read/);
});

test("photo reading: numbers the model returns are held to what they mean", () => {
  const messy: PhotoAssessment = { ...ASSESSMENT, rooms: [{ ...ASSESSMENT.rooms[0], condition: 9, photoIndexes: [0, 1, 1, 2, 7, -3] }, { ...ASSESSMENT.rooms[0], condition: 0, photoIndexes: [] }] };
  const tidy = tidyAssessment(messy, 2);
  assert.equal(tidy.rooms[0].condition, 5);
  assert.deepEqual(tidy.rooms[0].photoIndexes, [1, 2]);
  assert.equal(tidy.rooms[1].condition, 1);
});

test("evaluate: signed-out is 401; the asking price is required and must be a number", async () => {
  assert.equal((await rig({ userId: null }).evaluate({ address: "x", deal: { askingPrice: 1 } })).status, 401);
  const r = rig();
  for (const [body, message] of [
    [{ address: "demo" }, /Enter the asking price/],
    [{ address: "demo", deal: { askingPrice: null } }, /Asking price must be a number/],
    [{ address: "demo", deal: { askingPrice: 700_000, holdingMonths: "six" } }, /Hold \(months\) must be a number/],
    [{ address: "demo", deal: { askingPrice: 700_000, targetProfit: -1 } }, /Target profit cannot be below 0/],
    [{ subject: { id: "s" }, deal: { askingPrice: 700_000 } }, /Latitude must be a number/],
    [{ address: "demo", sales: "all of them", deal: { askingPrice: 700_000 } }, /`sales` must be a list/],
  ] as [unknown, RegExp][]) {
    const res = await r.evaluate(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, message);
  }
  assert.equal(r.store.runs.length, 0);
});

test("evaluate: runs the numbers, says they are a demo, and keeps the loan defaults a caller did not send", async () => {
  const r = rig();
  const res = await r.evaluate({ address: "demo", deal: { askingPrice: 700_000, financing: { rate: 0.09 } } });
  assert.equal(res.status, 200);
  assert.equal(res.body.demo, true);
  assert.match(res.body.warning, /^Demo numbers\./);
  // A lone rate used to wipe out loan-to-cost and points, and the financing cost with them.
  assert.ok(Number.isFinite(res.body.report.deal.financingCost) && res.body.report.deal.financingCost > 0);
  assert.ok(Number.isFinite(res.body.report.deal.maxAllowableOffer));
  assert.deepEqual(r.store.runs.map((x) => [x.kind, x.outcome.status]), [["quick", "ok"]]);
});

test("evaluate: facts and sales the caller brings are not called a demo", async () => {
  const r = rig();
  const market = demoProviders();
  const subject = await market.parcels.lookup("demo");
  const sales = await market.sales.salesNear(subject!, 2.5, 18, "2026-11-10");
  const res = await r.evaluate({ subject, sales, deal: { askingPrice: 700_000 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.demo, false);
  assert.equal(res.body.provider, "caller");
  assert.equal(res.body.warning, undefined);
  // Their facts with our (made-up) sales is still a demo.
  assert.equal((await r.evaluate({ subject, deal: { askingPrice: 700_000 } })).body.demo, true);
});

test("evaluate: the numbers cost nothing, so a database that is down does not stop them", async () => {
  const r = rig({ usage: BROKEN_STORE });
  const res = await r.evaluate({ address: "demo", deal: { askingPrice: 700_000 } });
  assert.equal(res.status, 200);
  assert.ok(Number.isFinite(res.body.report.deal.profit));
});

test("evaluate: has its own rate limit and leaves the monthly allowance alone", async () => {
  const r = rig({ limits: { quickPerWindow: 2, monthlyAnalyses: 1 } });
  const body = { address: "demo", deal: { askingPrice: 700_000 } };
  assert.equal((await r.evaluate(body)).status, 200);
  assert.equal((await r.evaluate(body)).status, 200);
  const third = await r.evaluate(body);
  assert.equal(third.status, 429);
  assert.equal(third.body.limit, "window");
  assert.equal((await r.analyze(HOUSE)).status, 200);
});

// ── real sold prices (RentCast connected) ───────────────────────────────────

/** RentCast as connected, answering from a stand-in that holds these records (lib/data/rentcast-fixtures.mts). */
function withRentcast(records: Record<string, unknown>[], budget: Partial<DataBudget> = {}) {
  const api = fakeRentcast(records);
  const r = rig({ rentcast: { key: "test-key", baseUrl: "https://api.test/v1", budget: { requests: 45, perPerson: 30, windowDays: 31, ...budget } }, rentcastFetch: api.fetch });
  return { ...r, api };
}

/** A listing page a person pasted for the house the fixtures are about. */
const PASTED = { url: "", fetched: true, address: SUBJECT_ADDRESS, price: 250_000, beds: 3, baths: 2, sqft: 1_800, photos: [] as string[] };

test("analyze with real sold prices: the result says UNTESTED, names where its numbers came from, and is not a GO", async () => {
  const r = withRentcast([subjectRecord(), ...soldHomes(40)]);
  const res = await r.analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.provider, res.body.demo, res.body.untested, res.body.fallback], ["rentcast", false, true, undefined]);
  assert.match(res.body.warning, /^Real sold prices, untested estimate\./);

  // At $250,000 against half-million-dollar sales the deal math says GO. It may not be given yet.
  const { deal, arv, subject } = res.body.report;
  assert.equal(deal.verdict, "CHECK FIRST");
  assert.deepEqual(deal.withheld?.map((w) => w.code), ["AREA_UNTESTED"]);
  assert.ok(deal.profit > DEFAULT_TARGET && deal.worstCaseProfit > 0, "the numbers themselves are untouched");
  assert.match(res.body.report.narrative[0], /^VERDICT: CHECK FIRST\./);

  // Built on the real record and real sales: addresses a reader can look up, no made-up condition, no made-up time drift.
  assert.equal(arv.conditionKnown, false);
  assert.ok(arv.comps.length >= 5 && arv.comps.every((c) => /Sample St, Fixture Falls, WA 98000$/.test(c.sale.address ?? "") && c.sale.condition === "unknown" && c.timeAdjustedPrice === c.sale.price));
  assert.ok(arv.point > 480_000 && arv.point < 560_000, `ARV ${arv.point}`);
  assert.deepEqual([subject.yearBuilt, subject.lotSqft, subject.garage, subject.submarket], [1984, 7_200, null, "98000"]);
  assert.deepEqual(res.body.subjectSources, { sqft: "listing", lotSqft: "record", beds: "listing", baths: "listing", yearBuilt: "record", garage: "record" });
  assert.equal(res.body.data.name, "RentCast");
  assert.equal(res.body.data.record.address, SUBJECT_ADDRESS);
  assert.deepEqual([res.body.data.search.radiusMiles, res.body.data.search.found], [1, 40]);
  // Nothing of an owner travels to the browser.
  assert.doesNotMatch(JSON.stringify(res.body), /Madeup|PO Box|mailing/i);

  // The AI is told the real year built now; it was never told the demo's.
  assert.deepEqual([r.seen.told[0].address, r.seen.told[0].yearBuilt, r.seen.told[0].submarket], [SUBJECT_ADDRESS, 1984, "98000"]);
  // Two paid requests, charged to the person who asked; the run itself counted once against their month.
  assert.deepEqual(r.data.requests.map((q) => [q.kind, q.userId, q.outcome.status]), [["property", "ann", "billed"], ["sales", "ann", "billed"]]);
  assert.equal(res.body.usage.used, 1);
});

test("analyze with real sold prices: a deal the numbers do not carry keeps its own verdict", async () => {
  const r = withRentcast([subjectRecord(), ...soldHomes(40)]);
  const res = await r.analyze({ listing: { ...PASTED, price: 640_000 }, photos: HOUSE.photos });
  assert.equal(res.body.report.deal.verdict, "PASS");
  assert.equal(res.body.report.deal.withheld, undefined);
  assert.equal(res.body.untested, true);
});

test("analyze: what can end a run for free is checked before a paid data request is made", async () => {
  const r = withRentcast([subjectRecord(), ...soldHomes(40)]);
  const noPrice = await r.analyze({ listing: { ...PASTED, price: undefined }, photos: HOUSE.photos });
  assert.equal(noPrice.status, 400);
  assert.match(noPrice.body.error, /Enter the asking price/);
  const noPhotos = await r.analyze({ listing: PASTED });
  assert.equal(noPhotos.status, 400);
  assert.equal(r.seen.houses.length, 0);
  assert.equal(r.api.calls.length, 0);
  assert.equal(r.data.requests.length, 0);
});

test("analyze: when real sold prices cannot be had for a house, it gets the demo's and is told why first", async () => {
  const r = withRentcast([subjectRecord(), ...soldHomes(40)], { requests: 2 });
  // An address the records do not have.
  const unknown = await r.analyze({ listing: { ...PASTED, address: "9 Nowhere Rd, Fixture Falls, WA 98000" }, photos: HOUSE.photos });
  assert.equal(unknown.status, 200);
  assert.deepEqual([unknown.body.provider, unknown.body.demo, unknown.body.untested, unknown.body.fallback.code, unknown.body.data], ["synthetic", true, false, "not-found", undefined]);
  assert.match(unknown.body.warning, /^The public records Renoflip reads \(through RentCast\) have no property at 9 Nowhere Rd, Fixture Falls, WA 98000\. Check the address on the listing; a home in a building needs its unit number\. Demo numbers\./);
  // A demo is a demo: its verdict is the deal math's, marked DEMO by whoever shows it, and no real fact is claimed.
  assert.ok(["GO", "TIGHT", "PASS"].includes(unknown.body.report.deal.verdict));
  assert.equal(r.seen.told[0].yearBuilt, undefined);

  // No address at all (photos dragged in, a price typed).
  const bare = await r.analyze(HOUSE);
  assert.deepEqual([bare.body.demo, bare.body.fallback.code], [true, "no-address"]);

  // The budget: one house goes through on it, the next finds it used up.
  assert.equal((await r.analyze({ listing: PASTED, photos: HOUSE.photos })).body.demo, false);
  const late = await r.analyze({ listing: { ...PASTED, address: "101 Sample St, Fixture Falls, WA 98000" }, photos: HOUSE.photos });
  assert.deepEqual([late.status, late.body.demo, late.body.fallback.code], [200, true, "budget"]);
  assert.match(late.body.warning, /^Renoflip's real sold-price lookups are used up for now; more open up on December 11\. Demo numbers\./);
  assert.equal(r.data.requests.filter((q) => q.outcome.status !== "free").length, 2, "nothing was spent past the budget");
});

test("analyze with real sold prices: a house nothing can be compared with ends before the AI, for free, and says so plainly", async () => {
  // Two sold homes are a value of sorts: given, marked low-confidence, and for two reasons not a GO.
  const few = withRentcast([subjectRecord(), ...soldHomes(2)]);
  const thin = await few.analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(thin.status, 200);
  assert.deepEqual([thin.body.report.arv.comps.length, thin.body.report.arv.confidence, thin.body.report.deal.verdict], [2, "LOW", "CHECK FIRST"]);
  assert.deepEqual(thin.body.report.deal.withheld?.map((w) => w.code), ["AREA_UNTESTED", "LOW_CONFIDENCE"]);
  assert.ok(thin.body.report.riskFlags.some((f) => f.code === "LOW_CONFIDENCE"));

  // None at all is no value.
  const r = withRentcast([subjectRecord()]);
  const res = await r.analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "No sold home that can be compared with this one was found in the public records as read on November 10: none of similar size within 5 miles in the last 24 months. The photos were not read, and this run does not count against your month.");
  assert.equal(r.seen.ai.length, 0);
  assert.deepEqual(r.store.runs.map((x) => x.outcome.status), ["free"]);
});

test("analyze with real sold prices: what the person is told matches how far the search really went", async () => {
  // Sold homes by the hundred, none of which can be compared with a house the caller says has thirty bedrooms:
  // the search stops at what one house may cost, two and a half miles out, and says so. It does not say "5 miles",
  // and it does not say that none of similar size sold: hundreds did, and that is what the person is told.
  const dense = withRentcast([subjectRecord(), ...soldHomes(700, { fromMiles: 0, withinMiles: 1 })]);
  const cut = await dense.analyze({ listing: PASTED, photos: HOUSE.photos, subject: { beds: 30, baths: 30 } });
  assert.equal(cut.status, 422);
  assert.match(cut.body.error, /^No sold home that can be compared with this one was found in the public records as read on November 10: \d{3} of similar size sold within 2\.5 miles in the last 18 months \(and more than could be read\), but none is close enough to this house, once what differs between them is counted, to price it from, and the search could not be taken further this time\. The photos were not read, and this run does not count against your month\.$/);
  assert.doesNotMatch(cut.body.error, /none of similar size/);
  assert.equal(dense.data.requests.filter((q) => q.outcome.status !== "free").length, 5, "one house, five requests at the most");
  assert.equal(dense.seen.ai.length, 0);

  // Thirty homes with this house's own rooms, lot and year, each two thirds of its size and under half its price:
  // what leaves them out is the adjustment for size. No reason is given that is not known to be the reason.
  const smaller = withRentcast([subjectRecord(), ...soldHomes(30, { made: { squareFootage: 1_300, soldFor: 200_000 } })]);
  const sized = await smaller.analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(sized.status, 422);
  assert.match(sized.body.error, /: 30 of similar size sold within 5 miles in the last 24 months, but none is close enough to this house, once what differs between them is counted, to price it from\. The photos/);
  assert.doesNotMatch(sized.body.error, /rooms|lot and age/);

  // Six homes sold around it and the records give the day and no price: that is said, not that none sold.
  const unpriced = withRentcast([subjectRecord(), ...soldHomes(6, { made: { soldFor: 0 } })]);
  const noPrice = await unpriced.analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(noPrice.status, 422);
  assert.equal(noPrice.body.error, "No sold home that can be compared with this one was found in the public records as read on November 10: 6 of similar size sold within 5 miles in the last 24 months, and none of them has a sale price on record that can be used. The photos were not read, and this run does not count against your month.");

  // The engine is handed how far the search went, and widens no further and no less. A house in the country, whose
  // sold homes are two to four and a half miles out and up to two years back, is valued from them (the demo's own
  // four steps stop at two and a half miles and would find too few); one whose search the budget cut short at two
  // and a half miles is never said to have comps "within 5 miles".
  const far = [subjectRecord(), ...soldHomes(2), ...soldHomes(20, { start: 100, fromMiles: 2, withinMiles: 4.5, withinDays: 700, fromDays: 200 })];
  const country = await withRentcast(far).analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(country.status, 200);
  assert.deepEqual([country.body.report.arv.criteriaUsed.radiusMiles, country.body.report.arv.criteriaUsed.months, country.body.report.arv.comps.length >= 5], [5, 24, true]);
  const shortOf = await withRentcast(far, { requests: 3 }).analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(shortOf.status, 200);
  assert.deepEqual([shortOf.body.data.search.radiusMiles, shortOf.body.data.search.stoppedEarly, shortOf.body.report.arv.criteriaUsed.radiusMiles], [2.5, true, 2.5]);
  assert.ok(![...shortOf.body.report.narrative, ...shortOf.body.report.riskFlags.map((f: { message: string }) => f.message)].some((line: string) => /5 miles|5 mi \//.test(line.replace(/2\.5 mi/g, ""))));
  // All three places that value the house are handed it: the check before the AI, the valuation the plan is built
  // on, and the report. With sold homes only three to four and a half miles out, any one of them left to the demo's
  // steps (which stop at two and a half miles) would find nothing to compare, and the run would end in "no comps".
  const onlyFar = await withRentcast([subjectRecord(), ...soldHomes(20, { start: 100, fromMiles: 3, withinMiles: 4.5, withinDays: 700, fromDays: 200 })]).analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.equal(onlyFar.status, 200, JSON.stringify(onlyFar.body.error));
  assert.deepEqual([onlyFar.body.report.arv.criteriaUsed.radiusMiles, onlyFar.body.report.arv.comps.length >= 5, Number.isFinite(onlyFar.body.plan.totals.costLikely), onlyFar.body.report.arv.comps.every((c) => c.distanceMiles > 2.5)], [5, true, true, true]);

  // The lookups run out after the first mile found nothing to compare: the person is told the lookups ran out,
  // and gets the demo, marked as one. Not "nothing sold within 5 miles".
  const oddHomes = soldHomes(2, { made: { bedrooms: 30, bathrooms: 30 } });
  const short = withRentcast([subjectRecord(), ...oddHomes], { requests: 2 });
  const out = await short.analyze({ listing: PASTED, photos: HOUSE.photos });
  assert.deepEqual([out.status, out.body.demo, out.body.fallback.code], [200, true, "budget"]);
  assert.match(out.body.warning, /^Renoflip's real sold-price lookups are used up for now/);

  // And when not even the demo can value the house as described, the reason real prices were not had is still said.
  const neither = withRentcast([subjectRecord(), ...soldHomes(2)], { requests: 2 });
  const none = await neither.analyze({ listing: PASTED, photos: HOUSE.photos, subject: { beds: 30, baths: 30 } });
  assert.equal(none.status, 422);
  assert.match(none.body.error, /^Renoflip's real sold-price lookups are used up for now; more open up on December 11\. No usable comps for this property\.$/);
});

test("analyze with real sold prices: where the listing and the public record disagree, the result says so", async () => {
  const r = withRentcast([subjectRecord(), ...soldHomes(40), ...soldHomes(30, { start: 200, made: { squareFootage: 2_300 } })]);
  const res = await r.analyze({ listing: { ...PASTED, sqft: 2_340, beds: 4, baths: 2.5, facts: { yearBuilt: { value: 1990, source: "text" } } }, photos: HOUSE.photos });
  assert.equal(res.status, 200);
  // The valuation goes by the listing: it is what is for sale.
  assert.deepEqual([res.body.report.subject.sqft, res.body.report.subject.beds, res.body.report.subject.yearBuilt], [2_340, 4, 1990]);
  const flag = res.body.report.riskFlags.find((f) => f.code === "RECORD_DIFFERS");
  assert.ok(flag);
  assert.equal(flag.basis, "record");
  assert.match(flag.message, /living area 2,340 sqft on the listing, 1,800 on record; 4 bedrooms on the listing, 3 on record; built 1990 on the listing, 1984 on record\./);
  // Half a bath is how sites count, not a difference.
  assert.doesNotMatch(flag.message, /bathrooms/);
  assert.match(flag.message, /without a permit/);
});

test("recordDiffers: only real differences, only where both sides speak", () => {
  const recorded = { sqft: 1_800, lotSqft: 7_200, beds: 3, baths: 2, yearBuilt: 1984, garage: null };
  assert.deepEqual(recordDiffers(recorded, { sqft: 1_850, beds: 3, baths: 2.5, yearBuilt: 1985 }), []);
  assert.deepEqual(recordDiffers(recorded, {}), []);
  assert.deepEqual(recordDiffers({ ...recorded, sqft: null, beds: null }, { sqft: 2_400, beds: 5 }), []);
  assert.match(recordDiffers(recorded, { baths: 3 })[0].message, /3 bathrooms on the listing, 2 on record/);
  assert.match(recordDiffers(recorded, { sqft: 1_500 })[0].message, /living area 1,500 sqft on the listing, 1,800 on record/);
});

test("the numbers-only route and Quick Numbers have no way to a paid data request", async () => {
  // They are wired to the demo's house and nothing else. This is a tripwire for the day somebody wires
  // them to the data layer: neither takes an address, and neither is held to a monthly allowance. It reads
  // what they import, and what the module they get the demo from imports in its turn.
  const PAID = /from\s+["'][^"']*(?:house-data|rentcast|prisma-data-store|budget|address-match)(?:\.ts)?["']/;
  for (const file of ["lib/api/evaluate.ts", "app/api/v1/evaluate/route.ts", "app/app/quick/page.tsx", "components/evaluator.tsx", "lib/data/index.ts", "lib/data/synthetic-provider.ts", "lib/data/demo.ts", "lib/data/provider.ts"]) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, PAID, `${file} reaches for the data provider`);
  }
  // (The tripwire itself trips on the file that does reach for it.)
  assert.match(readFileSync(new URL("../../app/api/v1/analyze/route.ts", import.meta.url), "utf8"), PAID);
  const r = withRentcast([subjectRecord(), ...soldHomes(40)]);
  const res = await r.evaluate({ address: SUBJECT_ADDRESS, deal: { askingPrice: 700_000 } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.provider, res.body.demo], ["synthetic", true]);
  assert.equal(r.api.calls.length, 0);
});

test("the demo does not age: the same house gets the same demo result whatever day it is asked", async () => {
  const r = rig();
  const first = await r.analyze(HOUSE);
  r.clock.now = new Date("2028-06-01T10:00:00.000Z");
  const later = await r.analyze(HOUSE);
  assert.equal(later.status, 200);
  assert.deepEqual([later.body.report.arv.point, later.body.report.arv.comps.length, later.body.report.deal.verdict], [first.body.report.arv.point, first.body.report.arv.comps.length, first.body.report.deal.verdict]);
  assert.ok(!later.body.report.riskFlags.some((f) => f.code === "STALE_SALES"));
});

/** A home handed over by the deal finder, as the analyzer sends it: its address, price, size and rooms; no link, no photos. */
const FROM_FINDER = { url: "", host: "", fetched: true, address: "608 Sample St, Fixture Falls, WA 98000", price: 245_000, beds: 3, baths: 2, sqft: 1_800, photos: [] as string[], read: { at: "2026-11-10T09:00:00.000Z", via: "finder" } };

test("analyze: a home from the deal finder has its photos looked for by its address, and is analysed with them", async () => {
  const PAGE_PHOTOS = ["https://photos.example/608-1.jpg", "https://photos.example/608-2.jpg"];
  const r = rig({
    resolveByAddress: async (address) => ({ url: "https://www.estately.com/listings/info/608-sample-st-fixture-falls-wa-98000", host: "www.estately.com", fetched: true, address, price: 245_000, photos: PAGE_PHOTOS, description: { text: "Solid house. Sold as-is.", source: "data" }, readFrom: { host: "estately.com", url: "https://www.estately.com/listings/info/608-sample-st-fixture-falls-wa-98000", reason: "placeholder" } }),
    fetchPhotos: async (urls) => ({ photos: urls.map(() => ({ base64: JPEG, mediaType: "image/jpeg" as const })), failed: [] }),
  });
  const res = await r.analyze({ listing: FROM_FINDER });
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  // It was looked for by the address the finder handed over, and nothing else was fetched as a link.
  assert.deepEqual([r.seen.resolved, r.seen.listings], [["608 Sample St, Fixture Falls, WA 98000"], []]);
  assert.deepEqual(r.seen.photoFetches, [PAGE_PHOTOS]);
  assert.equal(res.body.photosUsed.fromListing, 2);
  // The listing says where its page and photos came from, and that it came from the finder.
  assert.equal(res.body.listing.read?.via, "finder");
  assert.equal(res.body.listing.readFrom?.host, "estately.com");
  assert.equal(res.body.listing.readFrom?.reason, "The deal finder gives no photos, so this listing's page and photos were read from Estately, found by its address.");
  // The finder's facts stand: its price and size, the page's description beside them.
  assert.deepEqual([res.body.listing.price, res.body.listing.sqft, res.body.listing.description?.text], [245_000, 1_800, "Solid house. Sold as-is."]);
});

test("analyze: a home from the deal finder whose photos cannot be found says so, and how to add them, at no cost", async () => {
  const r = rig();
  const res = await r.analyze({ listing: FROM_FINDER });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Renoflip could not find this listing's photos online by its address (608 Sample St, Fixture Falls, WA 98000). Open the home on Zillow, drag its photos into the drop zone, and run it again.");
  // The AI was not asked, and the run is on record as free: it does not count against the month.
  assert.deepEqual([r.seen.ai.length, r.store.runs.map((run) => run.outcome.status)], [0, ["free"]]);
  // With photos of its own, a finder home is not looked up at all.
  const own = rig();
  const ran = await own.analyze({ listing: FROM_FINDER, photos: HOUSE.photos });
  assert.deepEqual([ran.status, own.seen.resolved], [200, []]);
  // Nor is a listing that did not come from the finder: without photos, it gets the usual answer.
  const pasted = rig();
  const plain = await pasted.analyze({ listing: { ...FROM_FINDER, read: { at: FROM_FINDER.read.at, via: "paste" } } });
  assert.deepEqual([plain.status, plain.body.error, pasted.seen.resolved], [400, "No photos. Upload the listing photos or pass photo URLs.", []]);
});

test("analyze: a page found by a finder home's address is used only when it says itself that it is that home", async () => {
  const PAGE = "https://www.estately.com/listings/info/608-sample-st-fixture-falls-wa-98000";
  const page = (said: { address?: string; price?: number }) => async () => ({ url: PAGE, host: "www.estately.com", fetched: true, photos: ["https://photos.example/p-1.jpg"], ...said, readFrom: { host: "estately.com", url: PAGE, reason: "placeholder" } });
  const fetchPhotos: AnalyzeDeps["fetchPhotos"] = async (urls) => ({ photos: urls.map(() => ({ base64: JPEG, mediaType: "image/jpeg" as const })), failed: [] });
  const cases: [string, { address?: string; price?: number }, string | null][] = [
    ["no address of its own (the zip code's search page, say)", { price: 245_000 }, "the page does not say which house it is"],
    ["another house", { address: "610 Sample St, Fixture Falls, WA 98000", price: 245_000 }, "it is for another house (610 Sample St, Fixture Falls, WA 98000)"],
    ["another street at the same number", { address: "608 Oak St, Fixture Falls, WA 98000", price: 245_000 }, "its address (608 Oak St, Fixture Falls, WA 98000) cannot be matched to this one"],
    ["a unit at the same number", { address: "608 Sample St, Unit 7, Fixture Falls, WA 98000", price: 245_000 }, "it is not this home's unit (608 Sample St, Unit 7, Fixture Falls, WA 98000)"],
    ["the same street word, the other side of town", { address: "608 N Sample St, Fixture Falls, WA 98000", price: 245_000 }, "its address (608 N Sample St, Fixture Falls, WA 98000) cannot be matched to this one"],
    ["the same street word, another kind of street", { address: "608 Sample Ave, Fixture Falls, WA 98000", price: 245_000 }, "its address (608 Sample Ave, Fixture Falls, WA 98000) cannot be matched to this one"],
    ["this house at another price", { address: "608 Sample Street, Fixture Falls, WA 98000", price: 199_000 }, "it gives another price ($199,000, not $245,000) and may be an older listing"],
    ["this house a little cheaper", { address: "608 Sample Street, Fixture Falls, WA 98000", price: 229_000 }, null],
    ["this house, no price on the page", { address: "608 SAMPLE ST, Fixture Falls, WA 98000" }, null],
  ];
  for (const [name, said, why] of cases) {
    const r = rig({ resolveByAddress: page(said), fetchPhotos });
    const res = await r.analyze({ listing: FROM_FINDER });
    if (why) {
      assert.equal(res.status, 400, name);
      assert.equal(res.body.error, `Renoflip found a page for 608 Sample St, Fixture Falls, WA 98000 on Estately, but ${why}, so its photos were not used. Open the home on Zillow, drag its photos into the drop zone, and run it again.`, name);
      // Its photos were not even fetched, and nothing was spent.
      assert.deepEqual([r.seen.photoFetches.flat(), r.seen.ai.length, r.store.runs.map((run) => run.outcome.status)], [[], 0, ["free"]], name);
    } else {
      assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body.error)}`);
      // Its photos were read; the finder's address and asking price stand.
      assert.deepEqual([r.seen.photoFetches, res.body.listing.address, res.body.listing.price], [[["https://photos.example/p-1.jpg"]], "608 Sample St, Fixture Falls, WA 98000", 245_000], name);
    }
  }
});
