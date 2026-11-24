import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate } from "@/lib/engine";
import type { PropertyFacts } from "@/lib/engine";
import { DEMO_WARNING, isDemoProvider, type Providers } from "@/lib/data";
import { admit, type Admission, type UsageLimits, type UsageStore } from "@/lib/usage/limits";
import { json } from "./analyze";
import { InputError, mergeDeal, readAsOf, readDeal, readSales, readSubject, readText } from "./inputs";

/**
 * POST /api/v1/evaluate: the numbers without photos. Session, database and
 * data providers come in as `deps`; app/api/v1/evaluate/route.ts supplies the
 * real ones.
 *
 * Body:
 *   { address: string }                       resolve via parcel provider, or
 *   { subject: PropertyFacts, sales?: Sale[] } bring your own facts and comps
 *   deal?: Partial<DealInputs>                 override any assumption; askingPrice is required
 *   asOf?: string                              valuation date, YYYY-MM-DD (default today)
 *
 * This is the same call a brokerage or lender would make from their side.
 * Per-organization API keys are added in phase 4. It costs nothing to run, so
 * it has a rate limit and no monthly allowance (lib/usage).
 */
export interface EvaluateDeps {
  userId: () => Promise<string | null>;
  usage: UsageStore;
  limits: () => UsageLimits;
  now: () => Date;
  providers: () => Providers;
}

export function createEvaluateHandler(deps: EvaluateDeps) {
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
    const body = raw as Record<string, unknown>;

    let input;
    try {
      input = {
        address: readText(body.address, "The address", 500),
        subject: body.subject === undefined || body.subject === null ? null : readSubject(body.subject),
        sales: body.sales === undefined || body.sales === null ? null : readSales(body.sales),
        deal: readDeal(body.deal),
        asOf: readAsOf(body.asOf),
      };
    } catch (err) {
      if (err instanceof InputError) return json({ error: err.message }, 400);
      throw err;
    }
    const askingPrice = input.deal.askingPrice;
    if (askingPrice === undefined) return json({ error: "Enter the asking price." }, 400);

    const startedAt = deps.now();
    // These numbers cost nothing to run. If the count cannot be taken, they are run anyway:
    // a database hiccup is no reason to refuse arithmetic.
    let gate: Admission | null = null;
    try {
      gate = await admit(deps.usage, deps.limits(), { userId, kind: "quick", at: startedAt });
    } catch (err) {
      console.error("[evaluate] usage check failed; running without it", err);
    }
    if (gate && !gate.ok) return json({ error: gate.message, limit: gate.reason }, 429, { "retry-after": String(gate.retryAfterSeconds) });
    const runId = gate?.ok ? gate.runId : null;

    let ok = false;
    try {
      const providers = deps.providers();
      const asOf = input.asOf ?? startedAt.toISOString().slice(0, 10);

      let subject: PropertyFacts | null = input.subject;
      if (!subject && input.address) subject = await providers.parcels.lookup(input.address);
      if (!subject) return json({ error: "Provide `subject` facts or an `address` the parcel provider can resolve." }, 400);

      const sales = input.sales ?? (await providers.sales.salesNear(subject, 2.5, 18, asOf));
      const report = evaluate({ subject, sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...mergeDeal(DEFAULT_DEAL_TERMS, input.deal), askingPrice } });

      // The caller's own facts and sales are theirs to vouch for; ours are a demo until a real provider is connected.
      const ours = !input.subject || !input.sales;
      const demo = ours && isDemoProvider(providers.name);
      ok = true;
      return json({ provider: ours ? providers.name : "caller", demo, warning: demo ? DEMO_WARNING.quick : undefined, report });
    } catch (err) {
      console.error("[evaluate] failed", err);
      return json({ error: "The numbers could not be run on our side. Try again in a minute." }, 500);
    } finally {
      if (runId) await deps.usage.finish(runId, { status: ok ? "ok" : "free", ms: deps.now().getTime() - startedAt.getTime() }).catch((err) => console.error("[evaluate] could not record the run", err));
    }
  };
}
