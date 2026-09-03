import { NextResponse } from "next/server";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, estimateArv, evaluate } from "@/lib/engine";
import type { DealInputs, PropertyFacts, RiskFlag } from "@/lib/engine";
import { planRenovation } from "@/lib/engine/renovation";
import { getProviders } from "@/lib/data";
import { analyzePhotos, MAX_PHOTOS, type PhotoInput } from "@/lib/vision/analyze-photos";
import { fetchListing, type ListingInfo } from "@/lib/listing/fetch-listing";

export const maxDuration = 120;

/**
 * POST /api/v1/analyze
 *
 * Body:
 *   listingUrl?: string                  pasted listing link (meta tags only; portals often block)
 *   photos?: ({url} | {base64, mediaType})[]   listing photos, max 12
 *   subject?: Partial<PropertyFacts>     override any fact
 *   deal?: Partial<DealInputs>           override any assumption; askingPrice falls back to the listing price
 *   asOf?: string
 *
 * Runs: listing metadata -> Claude vision on the photos -> ARV + ceiling ->
 * renovation plan ranked by profit -> deal math with the plan's cost.
 */
export async function POST(req: Request) {
  let body: {
    listingUrl?: string;
    photos?: PhotoInput[];
    subject?: Partial<PropertyFacts>;
    deal?: Partial<DealInputs>;
    asOf?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  let listing: ListingInfo | null = null;
  if (body.listingUrl) {
    try {
      new URL(body.listingUrl);
    } catch {
      return NextResponse.json({ error: "`listingUrl` is not a valid URL." }, { status: 400 });
    }
    listing = await fetchListing(body.listingUrl);
  }

  const photos = (body.photos?.length ? body.photos : (listing?.photos ?? []).map((url) => ({ url }))).slice(0, MAX_PHOTOS);
  if (photos.length === 0) {
    return NextResponse.json(
      { error: listing?.note ?? "No photos. Upload the listing photos or pass photo URLs.", listing },
      { status: 400 },
    );
  }

  const providers = getProviders();
  const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);
  const base = await providers.parcels.lookup(listing?.address ?? body.subject?.id ?? "demo");
  if (!base) return NextResponse.json({ error: "Could not resolve the property." }, { status: 400 });

  const facts: PropertyFacts = {
    ...base,
    ...(listing?.sqft ? { sqft: listing.sqft } : {}),
    ...(listing?.beds ? { beds: listing.beds } : {}),
    ...(listing?.baths ? { baths: listing.baths } : {}),
    ...body.subject,
  };

  const askingPrice = body.deal?.askingPrice ?? listing?.price;
  if (typeof askingPrice !== "number" || !(askingPrice > 0)) {
    return NextResponse.json({ error: "No asking price. Pass `deal.askingPrice` or a listing the price could be read from.", listing }, { status: 400 });
  }

  let assessment;
  try {
    assessment = await analyzePhotos(photos, {
      address: listing?.address,
      sqft: facts.sqft,
      beds: facts.beds,
      baths: facts.baths,
      yearBuilt: facts.yearBuilt,
      submarket: facts.submarket,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Photo analysis failed: ${message}`, listing }, { status: 502 });
  }

  const subject: PropertyFacts = { ...facts, condition: assessment.overallCondition };
  const sales = await providers.sales.salesNear(subject, 2.5, 18, asOf);
  const arv = estimateArv(subject, sales, asOf, DEFAULT_MARKET_CONFIG);
  if (Number.isNaN(arv.point)) {
    return NextResponse.json({ error: "No usable comps for this property.", listing, assessment }, { status: 422 });
  }

  const plan = planRenovation({
    subject,
    currentCondition: assessment.overallCondition,
    needs: assessment.categoryNeeds,
    arvPoint: arv.point,
    ceiling: arv.ceiling,
    config: DEFAULT_MARKET_CONFIG,
  });

  const report = evaluate({
    subject,
    sales,
    asOf,
    config: DEFAULT_MARKET_CONFIG,
    deal: { ...DEFAULT_DEAL_TERMS, ...body.deal, askingPrice, rehab: plan.rehab.likely },
  });

  const photoFlags: RiskFlag[] = [
    ...assessment.redFlags.map((m) => ({ code: "PHOTO_RED_FLAG", message: m })),
    ...assessment.unknowns.map((m) => ({ code: "VERIFY_ON_SITE", message: m })),
  ];
  report.riskFlags = [...photoFlags, ...report.riskFlags];
  report.narrative.splice(1, 0,
    `Photos: ${assessment.summary}`,
    `Renovation: $${Math.round(plan.totals.costLikely).toLocaleString("en-US")} likely (${Math.round(plan.totals.costLow).toLocaleString("en-US")} to ${Math.round(plan.totals.costHigh).toLocaleString("en-US")}) adds about $${Math.round(plan.totals.valueAdded).toLocaleString("en-US")}. ${plan.finishAdvice}`,
  );

  return NextResponse.json({
    provider: providers.name,
    warning: providers.name === "synthetic" ? "Synthetic market data. ARV, ceiling and comps are not real; the photo assessment is." : undefined,
    listing,
    assessment,
    plan,
    report,
  });
}
