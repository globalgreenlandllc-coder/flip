import type { ParcelProvider, SalesProvider } from "./provider";
import { SyntheticProvider } from "./synthetic-provider";

export interface Providers {
  sales: SalesProvider;
  parcels: ParcelProvider;
  name: string;
}

/**
 * The demo's made-up house and sales. Quick Numbers and the numbers-only
 * route run on these whatever else is connected: neither takes an address,
 * and neither may spend a paid data request.
 *
 * A full analysis gets its data through house-data.ts instead: real sold
 * prices from RentCast when a key is set (RENTCAST_API_KEY), these when it
 * is not or when real ones cannot be had for a house.
 */
export function demoProviders(): Providers {
  const synthetic = new SyntheticProvider();
  return { sales: synthetic, parcels: synthetic, name: "synthetic" };
}

export { DEMO_WARNING, UNTESTED_WARNING, isDemoProvider, isUntestedProvider, providerToSave } from "./demo";
export type { ParcelProvider, SalesProvider } from "./provider";
