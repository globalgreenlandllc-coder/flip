import { DEFAULT_DEAL_TERMS, estimateArv, evaluate, withGate } from "@/lib/engine";
import type { PropertyFacts, RiskFlag } from "@/lib/engine";
import { planRenovation } from "@/lib/engine/renovation";
import { AREA_TIME_ZONE } from "@/lib/area";
import { DEMO_WARNING, UNTESTED_WARNING } from "@/lib/data/demo";
import type { HouseAsk, HouseData, RecordedFacts } from "@/lib/data/house-data";
import { addressFromUrl, type ListingInfo } from "@/lib/listing/fetch-listing";
import { pageAddress, sameAddress, sameLink } from "@/lib/listing/house";
import { addressForBlocked, type ResolvedListing } from "@/lib/listing/resolve";
import { mergeListings, sourcesOf, subjectFromListing } from "@/lib/listing/subject";
import { UnsafeUrlError, checkUrl } from "@/lib/net/safe-fetch";
import { admit, type Admission, type RunOutcome, type UsageLimits, type UsageStore, type UsageSummary } from "@/lib/usage/limits";
import { MAX_PHOTOS, isPhotoReadError, type PhotoContext, type PhotoInput, type PhotoReading } from "@/lib/vision/analyze-photos";
import { InputError, mergeDeal, readAsOf, readDeal, readFactOverrides, readListing, readPhotos, readText, type DealOverrides, type PhotoIn } from "./inputs";

/**
 * POST /api/v1/analyze, without the things a test cannot have: the session,
 * the database, the network and the AI all come in as `deps`. The route file
 * (app/api/v1/analyze/route.ts) supplies the real ones.
 *
 * Body:
 *   listingUrl?: string                  pasted listing link (meta tags only; portals often block)
 *   listing?: ListingInfo                a listing the caller's browser already read: its description, facts with
 *                                        their sources, detail lines, photos. With photos, the server does not read the link.
 *                                        Its `url`, when it has one, must be the same page as `listingUrl`: one house per request.
 *   photos?: ({url} | {base64, mediaType})[]   listing photos, 16 used
 *   subject?: {sqft, lotSqft, beds, baths, yearBuilt, garage}   correct a fact
 *   deal?: Partial<DealInputs>           override any assumption; askingPrice falls back to the listing price
 *   asOf?: string                        YYYY-MM-DD
 *
 * Order: who is asking -> is the request well-formed -> may they run one more
 * (lib/usage) -> listing -> photos -> asking price -> the house's record and
 * the sold homes around it (lib/data/house-data.ts: real when a provider is
 * connected, the demo's otherwise) -> are there comps at all -> Claude vision
 * -> ARV + ceiling -> renovation plan ranked by profit -> deal math with the
 * plan's cost -> may it be a GO (lib/engine/gate.ts). Everything that can end
 * the run for free comes before the paid data, and that before the AI.
 */
export interface AnalyzeDeps {
  userId: () => Promise<string | null>;
  usage: UsageStore;
  limits: () => UsageLimits;
  now: () => Date;
  /** The house's public record and the sold homes around it: real when a data provider is connected, the demo's otherwise. */
  houseData: (ask: HouseAsk) => Promise<HouseData>;
  fetchListing: (url: string) => Promise<ListingInfo>;
  resolveByAddress: (address: string, blockedHost: string) => Promise<ResolvedListing | null>;
  fetchPhotos: (urls: string[]) => Promise<{ photos: PhotoInput[]; failed: string[] }>;
  readPhotos: (photos: PhotoInput[], context: PhotoContext) => Promise<PhotoReading>;
}

interface AnalyzeInput {
  listingUrl?: string;
  listing: ListingInfo | null;
  photos: PhotoIn[];
  facts: ReturnType<typeof readFactOverrides>;
  deal: DealOverrides;
  asOf?: string;
}

export const json = (data: unknown, status = 200, headers?: Record<string, string>) => Response.json(data, { status, headers });

/** All photos of one analysis together, as base64: about 18 MB of images, under the AI's limit for one request. */
const MAX_PHOTO_CHARS = 24_000_000;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 255);
  } catch {
    return null;
  }
}

function readInput(body: Record<string, unknown>, now: Date): AnalyzeInput {
  const listingUrl = readText(body.listingUrl, "The listing link", 2_000);
  if (listingUrl) checkUrl(listingUrl);
  const listing = body.listing === undefined || body.listing === null ? null : readListing(body.listing, MAX_PHOTOS, now);
  // One house per request. A reading of one page sent with the link of another would be
  // merged with whatever the server reads at that link, and come back looking like one listing.
  if (listing?.url && listingUrl && !sameLink(listing.url, listingUrl)) throw new InputError("`listing.url` and `listingUrl` are two different pages. Send the reading of a listing with that listing's own link, or without `listingUrl`.");
  return {
    listingUrl,
    listing,
    photos: readPhotos(body.photos),
    facts: readFactOverrides(body.subject),
    deal: readDeal(body.deal),
    asOf: readAsOf(body.asOf),
  };
}

/**
 * Where the listing and the public record say different things about the
 * house, as one risk flag. The listing's numbers are the ones the valuation
 * uses (it is what is for sale); the difference is the news. Living area a
 * tenth apart, a bedroom or a whole bathroom apart (sites count half baths
 * differently), years more than two apart.
 */
export function recordDiffers(recorded: RecordedFacts, listing: Partial<Record<"sqft" | "beds" | "baths" | "yearBuilt", number | null>>): RiskFlag[] {
  const n = (v: number) => v.toLocaleString("en-US");
  const apart: string[] = [];
  const both = (key: "sqft" | "beds" | "baths" | "yearBuilt"): [number, number] | null => {
    const said = listing[key];
    const onRecord = recorded[key];
    return typeof said === "number" && typeof onRecord === "number" ? [said, onRecord] : null;
  };
  const sqft = both("sqft");
  if (sqft && Math.abs(sqft[0] - sqft[1]) / Math.max(sqft[0], sqft[1]) > 0.1) apart.push(`living area ${n(sqft[0])} sqft on the listing, ${n(sqft[1])} on record`);
  const beds = both("beds");
  if (beds && beds[0] !== beds[1]) apart.push(`${beds[0]} bedrooms on the listing, ${beds[1]} on record`);
  const baths = both("baths");
  if (baths && Math.abs(baths[0] - baths[1]) >= 1) apart.push(`${baths[0]} bathrooms on the listing, ${baths[1]} on record`);
  const year = both("yearBuilt");
  if (year && Math.abs(year[0] - year[1]) > 2) apart.push(`built ${year[0]} on the listing, ${year[1]} on record`);
  if (apart.length === 0) return [];
  return [
    {
      code: "RECORD_DIFFERS",
      message: `The listing and the public record disagree: ${apart.join("; ")}. The numbers here use the listing's. Find out why before offering: space or rooms the county has no record of are often work done without a permit, and a buyer's appraiser goes by the record.`,
      basis: "record",
    },
  ];
}

/**
 * Why a page found by a deal finder home's address is not that home's, or null when it is. The page must say its
 * own address, with the home's number, street and zip code (a page with no address of its own, such as the zip
 * code's search page, is not this home's); and a price it gives must be within 15% of the home's asking price, since
 * a page for the address at another price may be an older listing, with older photos.
 */
export function notThisHome(home: Pick<ListingInfo, "address" | "price">, page: Pick<ListingInfo, "address" | "price">): string | null {
  if (!page.address) return "the page does not say which house it is";
  const same = sameAddress(home.address, page.address);
  if (same === "different") return `it is for another house (${page.address})`;
  if (same === "unknown") return `its address (${page.address}) cannot be matched to this one`;
  const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  if (typeof home.price === "number" && home.price > 0 && typeof page.price === "number" && Math.abs(page.price - home.price) > 0.15 * home.price) {
    return `it gives another price (${usd(page.price)}, not ${usd(home.price)}) and may be an older listing`;
  }
  return null;
}

export function createAnalyzeHandler(deps: AnalyzeDeps) {
  /** The analysis itself. `outcome` is filled in as it goes so the run is recorded truthfully however it ends. */
  async function analyze(input: AnalyzeInput, outcome: RunOutcome, usage: UsageSummary, userId: string): Promise<Response> {
    // What the person's browser read of the listing, if it read it. The server reads the link
    // itself only for what is still missing: when there is no such reading, or it came without
    // photos and none were sent beside it.
    let listing = input.listing;
    /** The site that would not let the server read the link, when that is why something is missing. */
    let blockedHost: string | null = null;
    if (input.listingUrl && (!listing || (listing.photos.length === 0 && input.photos.length === 0))) {
      let fetched = await deps.fetchListing(input.listingUrl);
      // Portal blocked the server: read the same MLS listing from a site that serves it.
      if (!fetched.fetched) {
        const address = addressForBlocked(fetched) ?? listing?.address;
        const alt = address ? await deps.resolveByAddress(address, fetched.host) : null;
        // A page that does not say its address is taken as the link's, as before (the link is the person's own).
        if (alt) fetched = { ...alt, address: alt.address ?? address, url: fetched.url, host: fetched.host, fetched: true, note: alt.readFrom.reason };
      }
      if (!fetched.fetched) blockedHost = fetched.host || listing?.host || null;
      // The person's browser read one house and the link turns out to be another: not merged
      // into one listing. (A link that does not say its address can have any page pasted under it.)
      if (listing && fetched.fetched && sameAddress(pageAddress(listing) ?? listing.address, fetched.address) === "different") {
        console.warn("[analyze] 400 page and link are two houses", { host: fetched.host });
        return json({ error: `The page that was read is for ${listing.address}, and the link is for ${fetched.address}. Clear the link, or paste that link's own page, and run it again.`, listing }, 400);
      }
      listing = listing ? mergeListings(listing, fetched) : fetched;
    }

    // A home handed over by the deal finder comes with its address and no photos (RentCast gives none). Its listing
    // is looked for by that address, the way a link a portal will not let the server read is, and its page is used
    // only when it says itself that it is this home (notThisHome). What is missing, when it is, is said as that.
    let finderMissing: string | null = null;
    if (!input.listingUrl && listing?.read?.via === "finder" && listing.photos.length === 0 && input.photos.length === 0 && listing.address) {
      const alt = await deps.resolveByAddress(listing.address, "the deal finder");
      const why = alt ? notThisHome(listing, alt) : null;
      if (alt && !why) {
        const reason = "The deal finder gives no photos, so this listing's page and photos were read from Estately, found by its address.";
        listing = mergeListings(listing, { ...alt, note: reason, readFrom: { ...alt.readFrom, reason } });
      } else if (alt) {
        console.warn("[analyze] the page found by the finder's address was not used", { host: alt.readFrom.host, why });
        finderMissing = `flip found a page for ${listing.address} on Estately, but ${why}, so its photos were not used.`;
      } else {
        finderMissing = `flip could not find this listing's photos online by its address (${listing.address}).`;
      }
    }

    // Uploaded photos first, then everything the listing page exposes, then
    // pasted links. Remote images are fetched here so a CDN that refuses
    // Claude's fetch, or one dead link, cannot sink the whole run.
    const uploaded = input.photos.filter((p): p is Extract<PhotoIn, { base64: string }> => "base64" in p);
    const remoteUrls = [...(listing?.photos ?? []), ...input.photos.filter((p): p is { url: string } => "url" in p).map((p) => p.url)].filter((u, i, arr) => arr.indexOf(u) === i);
    const { photos: remote, failed } = await deps.fetchPhotos(remoteUrls.slice(0, MAX_PHOTOS));
    // The AI takes one request of limited size. Photos are added in order until the next one
    // would not fit; the rest are left out and the person is told how many.
    const photos: PhotoInput[] = [];
    let chars = 0;
    for (const photo of [...uploaded, ...remote].slice(0, MAX_PHOTOS)) {
      const size = "base64" in photo ? photo.base64.length : 0;
      if (chars + size > MAX_PHOTO_CHARS) continue;
      chars += size;
      photos.push(photo);
    }
    const kept = (from: PhotoInput[]) => from.filter((p) => photos.includes(p)).length;
    const photosUsed = { uploaded: kept(uploaded), fromListing: kept(remote), failed: failed.length, leftOut: Math.min(uploaded.length + remote.length, MAX_PHOTOS) - photos.length };
    if (photos.length === 0) {
      // The server being turned away is said as that even when the person's browser had read the
      // page (without photos): what helps them next is the same three ways in.
      const error = blockedHost
        ? `${blockedHost} would not let us read the page${listing?.address ? ` for ${listing.address}` : ""}. On the listing page press ⌘A then ⌘C, paste into this form, and run it again. Or drag the gallery photos into the drop zone and enter the asking price.`
        : finderMissing && remoteUrls.length === 0
          ? `${finderMissing} Open the home on Zillow, drag its photos into the drop zone, and run it again.`
          : remoteUrls.length
          ? "None of the photo links could be fetched. Upload the photos instead."
          : "No photos. Upload the listing photos or pass photo URLs.";
      console.warn("[analyze] 400 no photos", { host: listing?.host, fetched: listing?.fetched, blocked: Boolean(blockedHost), pagePhotos: listing?.photos.length ?? 0, remoteUrls: remoteUrls.length, failed: failed.length, uploaded: uploaded.length });
      return json({ error, listing, blocked: Boolean(blockedHost) }, 400);
    }

    const asOf = input.asOf ?? deps.now().toISOString().slice(0, 10);

    // The asking price, before anything is asked of a paid data provider: a run that cannot go on ends here for free.
    const askingPrice = input.deal.askingPrice ?? listing?.price;
    if (typeof askingPrice !== "number" || !(askingPrice > 0)) {
      console.warn("[analyze] 400 no asking price", { host: listing?.host, fetched: listing?.fetched });
      return json({ error: listing ? "The listing did not give up its price. Enter the asking price and run it again." : "Enter the asking price.", listing }, 400);
    }

    // The house's facts: the provider's record, corrected by what the listing says, corrected by
    // what the caller sent. Where each one came from is kept and sent back with the result.
    const fromListing = subjectFromListing(listing);
    const address = listing?.address ?? addressFromUrl(listing?.url || input.listingUrl || "");
    const data = await deps.houseData({ address, overrides: { ...fromListing, ...input.facts }, userId, asOf });
    const { facts, demo } = data;
    const subjectSources = sourcesOf(input.facts, fromListing);

    // Are there sold homes to compare with at all? Asked before the AI is: a house nothing can
    // be compared to ends here, for free, and not after its photos were paid for. The answer
    // does not depend on the condition the photos will show (the value is of the house as
    // renovated), so it is the same question the full run asks later.
    if (Number.isNaN(estimateArv(facts, data.sales, asOf, data.config, { tiers: data.tiers }).point)) {
      console.warn("[analyze] 422 no usable comps", { host: listing?.host, provider: data.provider, sales: data.sales.length });
      // Said by how far the search really went, which is not always as far as it can go, and by what it found.
      // "None sold", "some sold and none has a price on record" and "plenty sold, none like this house" are three
      // different things to be told. Why none is like it is not said: the engine left them out for what they would
      // have to be adjusted by in all, and no one thing (rooms, lot, size) is known to be the reason.
      const went = data.source?.search;
      const span = went ? `within ${went.radiusMiles} mile${went.radiusMiles === 1 ? "" : "s"} in the last ${went.months} months` : "";
      const further = went?.stoppedEarly ? ", and the search could not be taken further this time" : "";
      const more = went?.sampled ? " (and more than could be read)" : "";
      const count = (n: number) => n.toLocaleString("en-US");
      const found = !went
        ? ""
        : went.found === 0
          ? `none of similar size ${span}${further}`
          : went.usable === 0
            ? `${count(went.found)} of similar size sold ${span}${more}, and none of them has a sale price on record that can be used${further}`
            : `${count(went.usable)} of similar size sold ${span}${more}, but none is close enough to this house, once what differs between them is counted, to price it from${further}`;
      // And by when: the answers may have been kept for up to a week, and "none sold" is true of the records as
      // they stood on the day they were read.
      const readOn = went ? new Date(went.readAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: AREA_TIME_ZONE }) : "";
      const error =
        demo || !went
          ? // A demo that stood in for real data says why it did, here too.
            [data.fallback?.message, "No usable comps for this property."].filter(Boolean).join(" ")
          : `No sold home that can be compared with this one was found in the public records as read on ${readOn}: ${found}. The photos were not read, and this run does not count against your month.`;
      return json({ error, listing, provider: data.provider }, 422);
    }

    // What the AI is told about the house. While the property record is made up, only what the
    // listing or the caller gave is passed on: a made-up year or neighbourhood must not colour
    // the one part of the result that is real.
    const real = <K extends "sqft" | "beds" | "baths" | "yearBuilt">(key: K) => (demo && subjectSources[key] === "record" ? undefined : (facts[key] ?? undefined));
    // (The area is passed on only when it is a real zip code: a record without one has a stand-in there.)
    const known: PhotoContext = { address: listing?.address, sqft: real("sqft"), beds: real("beds"), baths: real("baths"), yearBuilt: real("yearBuilt"), submarket: !demo && /^\d{5}$/.test(facts.submarket) ? facts.submarket : undefined };

    // From here the AI is asked, so the run counts against the month unless the AI never answered.
    outcome.status = "failed";
    outcome.photos = photos.length;
    let reading: PhotoReading;
    try {
      reading = await deps.readPhotos(photos, known);
    } catch (err) {
      const known = isPhotoReadError(err) ? err : null;
      if (known && !known.billed) outcome.status = "free";
      console.error("[analyze] photo reading failed", known ? (known.cause ?? known.message) : err);
      return json({ error: known ? `Photo analysis failed: ${known.message}` : "Photo analysis failed. Try again in a minute.", listing }, 502);
    }
    outcome.model = reading.model;
    outcome.inputTokens = reading.inputTokens;
    outcome.outputTokens = reading.outputTokens;
    const { assessment } = reading;

    const subject: PropertyFacts = { ...facts, condition: assessment.overallCondition };
    const arv = estimateArv(subject, data.sales, asOf, data.config, { tiers: data.tiers });
    if (Number.isNaN(arv.point)) return json({ error: "No usable comps for this property.", listing, assessment }, 422);

    const plan = planRenovation({
      subject,
      currentCondition: assessment.overallCondition,
      needs: assessment.categoryNeeds,
      // Comp-based (uncapped) ARV on purpose: the planner derives the as-is
      // value from it and lets the ceiling decide how much of the uplift the
      // block will pay for. Passing the already-capped arv.point made the
      // ceiling shrink every item a little instead of skipping the ones that
      // would not come back.
      arvPoint: arv.compBased,
      ceiling: arv.ceiling,
      config: data.config,
    });

    const worked = evaluate({ subject, sales: data.sales, asOf, config: data.config, tiers: data.tiers, deal: { ...mergeDeal(DEFAULT_DEAL_TERMS, input.deal), askingPrice, rehab: plan.rehab.likely } });
    // Real sold prices, and a method no area has been accuracy-tested with yet: the numbers may work, a GO may not be given.
    const report = demo ? worked : withGate(worked, { areaTested: false });

    const photoFlags: RiskFlag[] = [
      ...assessment.redFlags.map((m) => ({ code: "PHOTO_RED_FLAG", message: m, basis: "photos" as const })),
      ...assessment.unknowns.map((m) => ({ code: "VERIFY_ON_SITE", message: m, basis: "photos" as const })),
    ];
    // The age flags follow the year built, wherever that came from (the listing, the caller,
    // the property record); the rest follow the sales.
    const fromAge = subjectSources.yearBuilt;
    const differs = demo ? [] : recordDiffers(data.recorded, fromListing);
    report.riskFlags = [
      ...photoFlags,
      ...differs,
      ...report.riskFlags.map((f) => ({ ...f, basis: f.code === "PRE_1978" || f.code === "OLD_SYSTEMS" ? fromAge : f.code === "YEAR_UNKNOWN" ? ("record" as const) : ("sales" as const) })),
    ];
    report.narrative.splice(1, 0,
      `Photos: ${assessment.summary}`,
      `Renovation: $${Math.round(plan.totals.costLikely).toLocaleString("en-US")} likely (${Math.round(plan.totals.costLow).toLocaleString("en-US")} to ${Math.round(plan.totals.costHigh).toLocaleString("en-US")}) adds about $${Math.round(plan.totals.valueAdded).toLocaleString("en-US")}. ${plan.finishAdvice}`,
    );

    outcome.status = "ok";
    // A demo that stands in for real data says why first; a real result says what it is not yet.
    const warning = demo ? [data.fallback?.message, DEMO_WARNING.analysis].filter(Boolean).join(" ") : UNTESTED_WARNING.analysis;
    return json({ provider: data.provider, demo, untested: !demo, fallback: data.fallback, data: data.source, warning, listing, subjectSources, photosUsed, assessment, plan, report, usage });
  }

  return async function POST(req: Request): Promise<Response> {
    const userId = await deps.userId();
    if (!userId) return json({ error: "Sign in to use the API." }, 401);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Body must be a JSON object." }, 400);

    // Everything the caller sent is checked before a run is started or anything is fetched.
    let input: AnalyzeInput;
    try {
      input = readInput(raw as Record<string, unknown>, deps.now());
    } catch (err) {
      if (err instanceof InputError) return json({ error: err.message }, 400);
      if (err instanceof UnsafeUrlError) return json({ error: "That listing link cannot be read. Paste the link to the listing page itself, or add the photos." }, 400);
      throw err;
    }

    const startedAt = deps.now();
    let gate: Admission;
    try {
      gate = await admit(deps.usage, deps.limits(), { userId, kind: "analyze", source: hostOf(input.listing?.url || input.listingUrl), at: startedAt });
    } catch (err) {
      // No count, no run: an analysis nobody can account for is not started.
      console.error("[analyze] usage check failed", err);
      return json({ error: "flip could not check your usage just now. Try again in a minute." }, 503);
    }
    if (!gate.ok) return json({ error: gate.message, limit: gate.reason, usage: gate.usage }, 429, { "retry-after": String(gate.retryAfterSeconds) });

    const outcome: RunOutcome = { status: "free" };
    try {
      return await analyze(input, outcome, gate.usage, userId);
    } catch (err) {
      console.error("[analyze] failed", err);
      return json({ error: "The analysis failed on our side. Try again in a minute." }, 500);
    } finally {
      outcome.ms = deps.now().getTime() - startedAt.getTime();
      await deps.usage.finish(gate.runId, outcome).catch((err) => console.error("[analyze] could not record the run", err));
    }
  };
}
