import type { Condition, PropertyFacts, Sale } from "./types";

/**
 * Deterministic synthetic market for tests and the demo. This is the ONLY
 * fake part of the system. Replace it with a real SalesProvider and
 * everything downstream works unchanged.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONDITIONS: Condition[] = ["distressed", "dated", "average", "updated", "renovated"];
const CONDITION_MULT: Record<Condition, number> = {
  distressed: 0.8,
  dated: 0.9,
  average: 1,
  updated: 1.06,
  renovated: 1.12,
};

export interface SyntheticMarket {
  sales: Sale[];
  subject: PropertyFacts;
  /** Truth the generator used, so tests can check the engine recovers it. */
  truth: { basePpsf: Record<string, number>; monthlyAppreciation: number };
}

export function generateMarketData(opts: { seed?: number; count?: number; asOf?: string } = {}): SyntheticMarket {
  const rand = mulberry32(opts.seed ?? 42);
  const count = opts.count ?? 400;
  const asOf = opts.asOf ?? "2026-09-01";
  const centerLat = 47.68;
  const centerLng = -122.36;
  const monthlyAppreciation = 0.003;
  const basePpsf: Record<string, number> = { "98103": 520, "98117": 480, "98107": 560 };
  const submarkets = Object.keys(basePpsf);

  const gauss = () => {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const sales: Sale[] = [];
  for (let i = 0; i < count; i++) {
    const submarket = submarkets[Math.floor(rand() * submarkets.length)];
    const sqft = Math.round(1100 + rand() * 1600);
    const monthsAgo = rand() * 24;
    const condition = CONDITIONS[Math.floor(rand() * CONDITIONS.length)];
    const beds = 2 + Math.floor(rand() * 3);
    const baths = 1 + Math.floor(rand() * 3);
    const yearBuilt = 1920 + Math.floor(rand() * 100);
    const lotSqft = Math.round(3000 + rand() * 5000);
    const garage = Math.floor(rand() * 3);
    // Value at asOf, then discount back to sale date.
    const valueNow =
      basePpsf[submarket] * sqft * CONDITION_MULT[condition] +
      (beds - 3) * 8_000 +
      (baths - 2) * 12_000 +
      garage * 10_000 +
      (yearBuilt - 1970) * 500 +
      (lotSqft - 5000) * 4;
    const priceAtSale = (valueNow / (1 + monthlyAppreciation) ** monthsAgo) * (1 + gauss() * 0.04);
    const saleDate = new Date(new Date(asOf).getTime() - monthsAgo * 30.4375 * 86400000)
      .toISOString()
      .slice(0, 10);
    sales.push({
      id: `sale-${i}`,
      lat: centerLat + gauss() * 0.012,
      lng: centerLng + gauss() * 0.018,
      submarket,
      sqft,
      lotSqft,
      beds,
      baths,
      yearBuilt,
      garage,
      condition,
      price: Math.round(priceAtSale),
      saleDate,
    });
  }

  const subject: PropertyFacts = {
    id: "subject",
    lat: centerLat,
    lng: centerLng,
    submarket: "98103",
    sqft: 1840,
    lotSqft: 5200,
    beds: 3,
    baths: 2,
    yearBuilt: 1952,
    garage: 1,
    condition: "dated",
  };

  return { sales, subject, truth: { basePpsf, monthlyAppreciation } };
}
