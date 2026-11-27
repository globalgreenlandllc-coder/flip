import type { Heat } from "@/lib/engine/screen";

/** A home for sale as the map and the list show it. */
export interface MapHome {
  id: string;
  address: string;
  lat: number;
  lng: number;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  listingType: string | null;
  heat: Heat;
  profit: number | null;
  maxOffer: number | null;
  /** What similar homes sold for around it, how sure, and from how many sales. */
  value: { point: number; confidence: string; sales: number } | null;
  why?: string;
}

export const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

export const HEAT_WORDS: Record<Heat, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "No profit",
  unknown: "Can't value",
};

/** The home on Zillow, found by its address: a link the person follows in their own browser. */
export function zillowHref(address: string): string {
  const slug = address.replace(/[#,]/g, " ").trim().replace(/\s+/g, "-");
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`;
}

/** The full analysis, opened with the home's address, asking price, size and rooms filled in (lib/listing/prefill.ts, from=finder). */
export function analyzeHref(home: Pick<MapHome, "address" | "price" | "beds" | "baths" | "sqft">): string {
  const params = new URLSearchParams({ from: "finder", address: home.address, price: String(Math.round(home.price)) });
  if (home.beds !== null) params.set("beds", String(home.beds));
  if (home.baths !== null) params.set("baths", String(home.baths));
  if (home.sqft !== null) params.set("sqft", String(home.sqft));
  return `/app?${params.toString()}`;
}
