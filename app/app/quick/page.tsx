import { Evaluator } from "@/components/evaluator";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate } from "@/lib/engine";
import { getProviders } from "@/lib/data";

export const metadata = { title: "Quick numbers" };
export const dynamic = "force-dynamic";

const DEMO_ASKING_PRICE = 749_000;

/** Numbers without photos: server-renders a first report, then the client edits assumptions. */
export default async function QuickNumbersPage() {
  const providers = getProviders();
  const asOf = new Date().toISOString().slice(0, 10);
  const subject = await providers.parcels.lookup("demo");
  let initial = null;
  if (subject) {
    const sales = await providers.sales.salesNear(subject, 2.5, 18, asOf);
    initial = evaluate({ subject, sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: DEMO_ASKING_PRICE } });
  }
  const warning = providers.name === "synthetic" ? "Synthetic market data. Numbers are for exercising the engine only." : undefined;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Quick numbers</h1>
        <p className="mt-1 text-ink-700">No photos, just the deal math with a condition-tier rehab estimate. Change any assumption and re-run.</p>
      </div>
      <Evaluator initial={initial} initialWarning={warning} />
    </div>
  );
}
