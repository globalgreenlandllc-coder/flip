import type { ParcelProvider, SalesProvider } from "./provider";
import { SyntheticProvider } from "./synthetic-provider";

export interface Providers {
  sales: SalesProvider;
  parcels: ParcelProvider;
  name: string;
}

/**
 * Provider selection. Set DATA_PROVIDER=kingcounty once that loader exists;
 * anything else falls back to synthetic data and the API says so.
 */
export function getProviders(): Providers {
  const synthetic = new SyntheticProvider();
  return { sales: synthetic, parcels: synthetic, name: "synthetic" };
}

export { DEMO_WARNING, isDemoProvider } from "./demo";
export type { ParcelProvider, SalesProvider } from "./provider";
