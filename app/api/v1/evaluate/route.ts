import { NextResponse } from "next/server";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate } from "@/lib/engine";
import type { DealInputs, PropertyFacts, Sale } from "@/lib/engine";
import { getProviders } from "@/lib/data";

/**
 * POST /api/v1/evaluate
 *
 * Body:
 *   { address: string }                       resolve via parcel provider, or
 *   { subject: PropertyFacts, sales?: Sale[] } bring your own facts and comps
 *   deal?: Partial<DealInputs>                 override any assumption
 *   asOf?: string                              valuation date (default today)
 *
 * This is the same call a brokerage or lender would make from their side.
 * Auth and per-organization API keys are added in phase 4.
 */
export async function POST(req: Request) {
  let body: {
    address?: string;
    subject?: PropertyFacts;
    sales?: Sale[];
    deal?: Partial<DealInputs>;
    asOf?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const providers = getProviders();
  const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);

  let subject = body.subject ?? null;
  if (!subject && body.address) subject = await providers.parcels.lookup(body.address);
  if (!subject) {
    return NextResponse.json({ error: "Provide `subject` facts or an `address` the parcel provider can resolve." }, { status: 400 });
  }

  const askingPrice = body.deal?.askingPrice;
  if (typeof askingPrice !== "number" || !(askingPrice > 0)) {
    return NextResponse.json({ error: "`deal.askingPrice` must be a positive number." }, { status: 400 });
  }

  const sales = body.sales ?? (await providers.sales.salesNear(subject, 2.5, 18, asOf));
  const report = evaluate({
    subject,
    sales,
    asOf,
    config: DEFAULT_MARKET_CONFIG,
    deal: { ...DEFAULT_DEAL_TERMS, ...body.deal, askingPrice },
  });

  return NextResponse.json({
    provider: providers.name,
    warning: providers.name === "synthetic" ? "Synthetic market data. Numbers are for exercising the API only." : undefined,
    report,
  });
}
