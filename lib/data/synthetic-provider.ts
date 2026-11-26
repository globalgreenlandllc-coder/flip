import type { PropertyFacts, Sale } from "@/lib/engine/types";
import { generateMarketData, type SyntheticMarket } from "@/lib/engine/synthetic";
import type { ParcelProvider, SalesProvider } from "./provider";

/**
 * The demo: one made-up house among 600 made-up sales. What every result is
 * built on until real sales are connected, and what a result falls back on
 * when they cannot be had for a house (house-data.ts).
 */
export class SyntheticProvider implements SalesProvider, ParcelProvider {
  private market: SyntheticMarket | null = null;
  private marketAsOf = "";

  /**
   * The made-up sales, dated back from the day asked about. They used to be
   * dated back from one fixed day, so the demo's sales grew older every day
   * it ran: by the spring of 2028 none would have been recent enough to
   * compare with.
   */
  private marketFor(asOf: string): SyntheticMarket {
    if (!this.market || this.marketAsOf !== asOf) {
      this.market = generateMarketData({ seed: 42, count: 600, asOf });
      this.marketAsOf = asOf;
    }
    return this.market;
  }

  async salesNear(_subject: PropertyFacts, _radiusMiles: number, _months: number, asOf: string): Promise<Sale[]> {
    return this.marketFor(asOf).sales;
  }

  async lookup(): Promise<PropertyFacts | null> {
    // The house itself does not depend on the day.
    return generateMarketData({ seed: 42, count: 0 }).subject;
  }
}
