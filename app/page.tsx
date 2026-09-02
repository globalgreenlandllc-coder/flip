import { Evaluator } from "@/components/evaluator";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate } from "@/lib/engine";
import { getProviders } from "@/lib/data";

export const dynamic = "force-dynamic";

const DEMO_ASKING_PRICE = 749_000;

/**
 * Server-renders the first report so the page is never empty, then hands
 * off to the client evaluator for edits. Same engine call as the API.
 */
export default async function Home() {
  const providers = getProviders();
  const asOf = new Date().toISOString().slice(0, 10);
  const subject = await providers.parcels.lookup("demo");
  let initial = null;
  if (subject) {
    const sales = await providers.sales.salesNear(subject, 2.5, 18, asOf);
    initial = evaluate({
      subject,
      sales,
      asOf,
      config: DEFAULT_MARKET_CONFIG,
      deal: { ...DEFAULT_DEAL_TERMS, askingPrice: DEMO_ASKING_PRICE },
    });
  }
  const warning = providers.name === "synthetic" ? "Synthetic market data. Numbers are for exercising the API only." : undefined;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">flip</h1>
      <p className="mt-1 text-neutral-500">Address in. GO / TIGHT / PASS out, with the numbers that back it up.</p>
      <Evaluator initial={initial} initialWarning={warning} />
    </main>
  );
}
