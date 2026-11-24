import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, estimateArv, evaluate } from "@/lib/engine";
import type { PropertyFacts, RiskFlag } from "@/lib/engine";
import { planRenovation } from "@/lib/engine/renovation";
import { DEMO_WARNING, isDemoProvider, type Providers } from "@/lib/data";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import { addressForBlocked, type ResolvedListing } from "@/lib/listing/resolve";
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
 *   listing?: ListingInfo                a listing the caller's browser already read; skips the server fetch
 *   photos?: ({url} | {base64, mediaType})[]   listing photos, 16 used
 *   subject?: {sqft, lotSqft, beds, baths, yearBuilt, garage}   correct a fact
 *   deal?: Partial<DealInputs>           override any assumption; askingPrice falls back to the listing price
 *   asOf?: string                        YYYY-MM-DD
 *
 * Order: who is asking -> is the request well-formed -> may they run one more
 * (lib/usage) -> listing -> photos -> Claude vision -> ARV + ceiling ->
 * renovation plan ranked by profit -> deal math with the plan's cost.
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

function readInput(body: Record<string, unknown>): AnalyzeInput {
  const listingUrl = readText(body.listingUrl, "The listing link", 2_000);
  if (listingUrl) checkUrl(listingUrl);
  return {
    listingUrl,
    listing: body.listing === undefined || body.listing === null ? null : readListing(body.listing, MAX_PHOTOS),
    photos: readPhotos(body.photos),
    facts: readFactOverrides(body.subject),
    deal: readDeal(body.deal),
    asOf: readAsOf(body.asOf),
  };
}

export function createAnalyzeHandler(deps: AnalyzeDeps) {
  /** The analysis itself. `outcome` is filled in as it goes so the run is recorded truthfully however it ends. */
  async function analyze(input: AnalyzeInput, outcome: RunOutcome, usage: UsageSummary): Promise<Response> {
    let listing = input.listing;
    if (!listing && input.listingUrl) {
      listing = await deps.fetchListing(input.listingUrl);
      // Portal blocked the server: read the same MLS listing from a site that serves it.
      if (!listing.fetched) {
        const address = addressForBlocked(listing);
        const alt = address ? await deps.resolveByAddress(address, listing.host) : null;
        if (alt) listing = { ...alt, url: listing.url, host: listing.host, fetched: true, note: alt.readFrom.reason };
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
      const error = listing && !listing.fetched
        ? `${listing.host} would not let us read the page${listing.address ? ` for ${listing.address}` : ""}. On the listing page press ⌘A then ⌘C, paste into this form, and run it again. Or drag the gallery photos into the drop zone and enter the asking price.`
        : remoteUrls.length
          ? "None of the photo links could be fetched. Upload the photos instead."
          : "No photos. Upload the listing photos or pass photo URLs.";
      console.warn("[analyze] 400 no photos", { host: listing?.host, fetched: listing?.fetched, pagePhotos: listing?.photos.length ?? 0, remoteUrls: remoteUrls.length, failed: failed.length, uploaded: uploaded.length });
      return json({ error, listing }, 400);
    }

    const providers = deps.providers();
    const asOf = input.asOf ?? deps.now().toISOString().slice(0, 10);
    const base = await providers.parcels.lookup(listing?.address ?? "demo");
    if (!base) return json({ error: "Could not resolve the property." }, 400);

    const facts: PropertyFacts = {
      ...base,
      ...(listing?.sqft ? { sqft: listing.sqft } : {}),
      ...(listing?.beds ? { beds: listing.beds } : {}),
      ...(listing?.baths ? { baths: listing.baths } : {}),
      ...input.facts,
    };

    const askingPrice = input.deal.askingPrice ?? listing?.price;
    if (typeof askingPrice !== "number" || !(askingPrice > 0)) {
      console.warn("[analyze] 400 no asking price", { host: listing?.host, fetched: listing?.fetched });
      return json({ error: listing ? "The listing did not give up its price. Enter the asking price and run it again." : "Enter the asking price.", listing }, 400);
    }

    // What the AI is told about the house. While the property record is made up, only what the
    // listing or the caller gave is passed on: a made-up year or neighbourhood must not colour
    // the one part of the result that is real.
    const demo = isDemoProvider(providers.name);
    const known: PhotoContext = demo
      ? { address: listing?.address, sqft: input.facts.sqft ?? listing?.sqft, beds: input.facts.beds ?? listing?.beds, baths: input.facts.baths ?? listing?.baths, yearBuilt: input.facts.yearBuilt }
      : { address: listing?.address, sqft: facts.sqft, beds: facts.beds, baths: facts.baths, yearBuilt: facts.yearBuilt, submarket: facts.submarket };

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
    const sales = await providers.sales.salesNear(subject, 2.5, 18, asOf);
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
      ...assessment.redFlags.map((m) => ({ code: "PHOTO_RED_FLAG", message: m })),
      ...assessment.unknowns.map((m) => ({ code: "VERIFY_ON_SITE", message: m })),
    ];
    report.riskFlags = [...photoFlags, ...report.riskFlags];
    report.narrative.splice(1, 0,
      `Photos: ${assessment.summary}`,
      `Renovation: $${Math.round(plan.totals.costLikely).toLocaleString("en-US")} likely (${Math.round(plan.totals.costLow).toLocaleString("en-US")} to ${Math.round(plan.totals.costHigh).toLocaleString("en-US")}) adds about $${Math.round(plan.totals.valueAdded).toLocaleString("en-US")}. ${plan.finishAdvice}`,
    );

    outcome.status = "ok";
    return json({ provider: providers.name, demo, warning: demo ? DEMO_WARNING.analysis : undefined, listing, photosUsed, assessment, plan, report, usage });
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
      input = readInput(raw as Record<string, unknown>);
    } catch (err) {
      if (err instanceof InputError) return json({ error: err.message }, 400);
      if (err instanceof UnsafeUrlError) return json({ error: "That listing link cannot be read. Paste the link to the listing page itself, or add the photos." }, 400);
      throw err;
    }

    const startedAt = deps.now();
    let gate: Admission;
    try {
      gate = await admit(deps.usage, deps.limits(), { userId, kind: "analyze", source: hostOf(input.listing?.url ?? input.listingUrl), at: startedAt });
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
