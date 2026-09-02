import type { PropertyFacts, Sale } from "@/lib/engine/types";
import { generateMarketData } from "@/lib/engine/synthetic";
import type { ParcelProvider, SalesProvider } from "./provider";

/** Dev-only provider so the API runs before any real data is wired. */
export class SyntheticProvider implements SalesProvider, ParcelProvider {
  private market = generateMarketData({ seed: 42, count: 600 });

  async salesNear(): Promise<Sale[]> {
    return this.market.sales;
  }

  async lookup(): Promise<PropertyFacts | null> {
    return this.market.subject;
  }
}
