import type { PropertyFacts, Sale } from "@/lib/engine/types";

/**
 * The seam between the engine and the real world. One implementation per
 * data source. The engine never imports from here.
 */
export interface SalesProvider {
  /** Sold records that could plausibly be comps: wide net, the engine filters. */
  salesNear(subject: PropertyFacts, radiusMiles: number, months: number, asOf: string): Promise<Sale[]>;
}

export interface ParcelProvider {
  /** Resolve a street address to property facts. Null if not found. */
  lookup(address: string): Promise<PropertyFacts | null>;
}
