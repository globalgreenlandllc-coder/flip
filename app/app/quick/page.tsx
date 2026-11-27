import { Evaluator } from "@/components/evaluator";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate } from "@/lib/engine";
import { demoProviders } from "@/lib/data";

export const metadata = { title: "Quick numbers" };
export const dynamic = "force-dynamic";

const DEMO_ASKING_PRICE = 749_000;

/** Numbers without photos: server-renders a first report, then the client edits assumptions. */
export default async function QuickNumbersPage() {
  // Quick Numbers has no address field: it shows the deal math on the demo's made-up house, and says so.
  const providers = demoProviders();
  const asOf = new Date().toISOString().slice(0, 10);
  const subject = await providers.parcels.lookup("demo");
  let initial = null;
  if (subject) {
    const sales = await providers.sales.salesNear(subject, 2.5, 18, asOf);
    initial = evaluate({ subject, sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: DEMO_ASKING_PRICE } });
  }

  return (
    <div>
      <div className="mb-7">
        <p className="eyebrow mb-2.5">A quick sanity check</p>
        <h1 className="page-title">Run the numbers.</h1>
        <p className="page-lede max-w-2xl">No photos, no address: the deal math on the demo house, with the renovation priced from its condition. Change a number and run it again to see what moves the profit.</p>
      </div>
      <Evaluator initial={initial} initialProvider={providers.name} />
    </div>
  );
}
