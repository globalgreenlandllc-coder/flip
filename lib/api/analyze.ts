import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, estimateArv, evaluate } from "@/lib/engine";
import type { PropertyFacts, RiskFlag } from "@/lib/engine";
import { planRenovation } from "@/lib/engine/renovation";
import { DEMO_WARNING, isDemoProvider, type Providers } from "@/lib/data";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
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
 * (lib/usage) -> listing -> photos -> are there comps at all -> Claude vision ->
 * ARV + ceiling -> renovation plan ranked by profit -> deal math with the
 * plan's cost. Everything that can end the run for free comes before the AI.
 */
export interface AnalyzeDeps {
  userId: () => Promise<string | null>;
  usage: UsageStore;
  limits: () => UsageLimits;
  now: () => Date;
  providers: () => Providers;
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

export function createAnalyzeHandler(deps: AnalyzeDeps) {
  /** The analysis itself. `outcome` is filled in as it goes so the run is recorded truthfully however it ends. */
  async function analyze(input: AnalyzeInput, outcome: RunOutcome, usage: UsageSummary): Promise<Response> {
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
        if (alt) fetched = { ...alt, url: fetched.url, host: fetched.host, fetched: true, note: alt.readFrom.reason };
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
        : remoteUrls.length
          ? "None of the photo links could be fetched. Upload the photos instead."
          : "No photos. Upload the listing photos or pass photo URLs.";
      console.warn("[analyze] 400 no photos", { host: listing?.host, fetched: listing?.fetched, blocked: Boolean(blockedHost), pagePhotos: listing?.photos.length ?? 0, remoteUrls: remoteUrls.length, failed: failed.length, uploaded: uploaded.length });
      return json({ error, listing, blocked: Boolean(blockedHost) }, 400);
    }

    const providers = deps.providers();
    const asOf = input.asOf ?? deps.now().toISOString().slice(0, 10);
    const base = await providers.parcels.lookup(listing?.address ?? "demo");
    if (!base) return json({ error: "Could not resolve the property." }, 400);

    // The house's facts: the provider's record, corrected by what the listing says, corrected by
    // what the caller sent. Where each one came from is kept and sent back with the result.
    const fromListing = subjectFromListing(listing);
    const facts: PropertyFacts = { ...base, ...fromListing, ...input.facts };
    const subjectSources = sourcesOf(input.facts, fromListing);

    const askingPrice = input.deal.askingPrice ?? listing?.price;
    if (typeof askingPrice !== "number" || !(askingPrice > 0)) {
      console.warn("[analyze] 400 no asking price", { host: listing?.host, fetched: listing?.fetched });
      return json({ error: listing ? "The listing did not give up its price. Enter the asking price and run it again." : "Enter the asking price.", listing }, 400);
    }

    // Are there sold homes to compare with at all? Asked before the AI is: a house nothing can
    // be compared to ends here, for free, and not after its photos were paid for. The answer
    // does not depend on the condition the photos will show (the value is of the house as
    // renovated), so it is the same question the full run asks later.
    const sales = await providers.sales.salesNear(facts, 2.5, 18, asOf);
    if (Number.isNaN(estimateArv(facts, sales, asOf, DEFAULT_MARKET_CONFIG).point)) {
      console.warn("[analyze] 422 no usable comps", { host: listing?.host, sales: sales.length });
      return json({ error: "No usable comps for this property.", listing }, 422);
    }

    // What the AI is told about the house. While the property record is made up, only what the
    // listing or the caller gave is passed on: a made-up year or neighbourhood must not colour
    // the one part of the result that is real.
    const demo = isDemoProvider(providers.name);
    const real = <K extends "sqft" | "beds" | "baths" | "yearBuilt">(key: K) => (demo && subjectSources[key] === "record" ? undefined : facts[key]);
    const known: PhotoContext = { address: listing?.address, sqft: real("sqft"), beds: real("beds"), baths: real("baths"), yearBuilt: real("yearBuilt"), submarket: demo ? undefined : facts.submarket };

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
    const arv = estimateArv(subject, sales, asOf, DEFAULT_MARKET_CONFIG);
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
      config: DEFAULT_MARKET_CONFIG,
    });

    const report = evaluate({ subject, sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...mergeDeal(DEFAULT_DEAL_TERMS, input.deal), askingPrice, rehab: plan.rehab.likely } });

    const photoFlags: RiskFlag[] = [
      ...assessment.redFlags.map((m) => ({ code: "PHOTO_RED_FLAG", message: m, basis: "photos" as const })),
      ...assessment.unknowns.map((m) => ({ code: "VERIFY_ON_SITE", message: m, basis: "photos" as const })),
    ];
    // The age flags follow the year built, wherever that came from (the listing, the caller,
    // the property record); the rest follow the sales.
    const fromAge = subjectSources.yearBuilt;
    report.riskFlags = [...photoFlags, ...report.riskFlags.map((f) => ({ ...f, basis: f.code === "PRE_1978" || f.code === "OLD_SYSTEMS" ? fromAge : ("sales" as const) }))];
    report.narrative.splice(1, 0,
      `Photos: ${assessment.summary}`,
      `Renovation: $${Math.round(plan.totals.costLikely).toLocaleString("en-US")} likely (${Math.round(plan.totals.costLow).toLocaleString("en-US")} to ${Math.round(plan.totals.costHigh).toLocaleString("en-US")}) adds about $${Math.round(plan.totals.valueAdded).toLocaleString("en-US")}. ${plan.finishAdvice}`,
    );

    outcome.status = "ok";
    return json({ provider: providers.name, demo, warning: demo ? DEMO_WARNING.analysis : undefined, listing, subjectSources, photosUsed, assessment, plan, report, usage });
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
      return await analyze(input, outcome, gate.usage);
    } catch (err) {
      console.error("[analyze] failed", err);
      return json({ error: "The analysis failed on our side. Try again in a minute." }, 500);
    } finally {
      outcome.ms = deps.now().getTime() - startedAt.getTime();
      await deps.usage.finish(gate.runId, outcome).catch((err) => console.error("[analyze] could not record the run", err));
    }
  };
}
