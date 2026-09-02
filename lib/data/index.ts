import type { ParcelProvider, SalesProvider } from "./provider";
import { SyntheticProvider } from "./synthetic-provider";

/**
 * Provider selection. Set DATA_PROVIDER=kingcounty once that loader exists;
 * anything else falls back to synthetic data and the API says so.
 */
export function getProviders(): { sales: SalesProvider; parcels: ParcelProvider; name: string } {
  const synthetic = new SyntheticProvider();
  return { sales: synthetic, parcels: synthetic, name: "synthetic" };
}

export type { ParcelProvider, SalesProvider } from "./provider";
