import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnalyzeHandler, type AnalyzeDeps } from "./analyze.ts";
import { createEvaluateHandler } from "./evaluate.ts";
import { InputError, readPhotos } from "./inputs.ts";
import { getProviders } from "../data/index.ts";
import { DEFAULT_LIMITS, MemoryUsageStore, usageSummary, type UsageLimits, type UsageStore } from "../usage/limits.ts";
import { PhotoReadError, tidyAssessment, type PhotoContext, type PhotoInput, type PhotoReading } from "../vision/analyze-photos.ts";
import type { PhotoAssessment } from "../vision/schema.ts";
import type { Report } from "../engine/types.ts";

/** The fields a reply can carry; each test reads the ones its case returns. */
interface Reply {
  error: string;
  limit: string;
  provider: string;
  demo: boolean;
  warning: string;
  usage: { used: number; limit: number; resetsOn: string };
  report: Report;
  listing: { title: string; host: string; price?: number; beds?: number; sqft?: number; photos: string[] };
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
function rig(over: { limits?: Partial<UsageLimits>; userId?: string | null; usage?: UsageStore; readPhotos?: AnalyzeDeps["readPhotos"] } = {}) {
  const store = new MemoryUsageStore();
  const seen = { ai: [] as PhotoInput[][], told: [] as PhotoContext[], listings: [] as string[], photoFetches: [] as string[][] };
  const clock = { now: new Date("2026-11-10T10:00:00.000Z"), user: over.userId === undefined ? "ann" : over.userId };
  const deps: AnalyzeDeps = {
    userId: async () => clock.user,
    usage: over.usage ?? store,
    limits: () => ({ ...DEFAULT_LIMITS, ...over.limits }),
    now: () => clock.now,
    providers: getProviders,
    fetchListing: async (url) => {
      seen.listings.push(url);
      return { url, host: new URL(url).hostname, fetched: false, note: "blocked", photos: [] };
    },
    resolveByAddress: async () => null,
    fetchPhotos: async (urls) => {
      seen.photoFetches.push(urls);
      return { photos: [], failed: urls };
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
  return { store, seen, clock, deps, analyze: post(createAnalyzeHandler(deps)), evaluate: post(createEvaluateHandler(deps)) };
}

const HOUSE = { photos: [{ base64: JPEG, mediaType: "image/jpeg" }], deal: { askingPrice: 640_000 } };

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
  const base = await getProviders().parcels.lookup("demo");
  assert.equal(res.body.report.subject.sqft, 2_000);
  assert.equal(res.body.report.subject.lat, base!.lat);
  assert.equal(res.body.report.subject.id, base!.id);
  assert.equal(res.body.report.subject.submarket, base!.submarket);
  // Condition comes from the photos.
  assert.equal(res.body.report.subject.condition, "dated");
});

test("analyze: what a parser read off a page is kept when sane and left out when not, never thrown back at the person", async () => {
  const r = rig();
  const base = await getProviders().parcels.lookup("demo");
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
  assert.equal(res.body.listing.title.length, 500);
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
  await r.analyze(HOUSE);
  // Nothing from the made-up record: no year, no neighbourhood, no size.
  assert.deepEqual(r.seen.told[0], { address: undefined, sqft: undefined, beds: undefined, baths: undefined, yearBuilt: undefined });
  const listing = { url: "https://www.zillow.com/homedetails/1-Main-St-Graham-WA-98338/1_zpid/", fetched: true, address: "1 Main St, Graham, WA 98338", sqft: 2_150, beds: 4, photos: [] };
  await r.analyze({ ...HOUSE, listing, subject: { baths: 2.5 } });
  assert.deepEqual(r.seen.told[1], { address: "1 Main St, Graham, WA 98338", sqft: 2_150, beds: 4, baths: 2.5, yearBuilt: undefined });
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
  const market = getProviders();
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
