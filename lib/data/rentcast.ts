import type { Sale } from "@/lib/engine/types";

/**
 * RentCast (developers.rentcast.io): a property's public record by its
 * address, and the properties around a point with when and for how much each
 * last sold. This file is the wire: what is asked, and what is kept of the
 * answer. What it costs and how often it may be asked is budget.ts; how a
 * house's data is put together is house-data.ts.
 *
 * What is kept of a record is PropertyRecord and nothing else. The owner's
 * name and mailing address, the legal description, the tax history are in the
 * answer and are never read into a variable, stored or logged.
 *
 * Billing, from RentCast's own pages (read 2026-11-25): a request answered
 * 200 is billed, any other status is not, there is no hard cap, and every
 * request past the plan's monthly number is charged by itself. So a request
 * that got no answer at all (a timeout) is counted as billed: it may have
 * been.
 */
export const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";

/** The most records one request returns (RentCast's own limit). */
export const RENTCAST_PAGE = 500;

/** The kinds of home flip compares with their own kind. Land, apartment buildings and multi-family are not valued. */
export const HOME_TYPES = ["Single Family", "Townhouse", "Condo", "Manufactured"] as const;

export interface PropertyRecord {
  id: string;
  address: string;
  lat: number;
  lng: number;
  zip: string | null;
  county: string | null;
  propertyType: string | null;
  sqft: number | null;
  lotSqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  /** Garage spaces when the record counts them, 0 when it says there is none; null when it only says there is one, or nothing. */
  garage: number | null;
  /** The last recorded sale, as a date (YYYY-MM-DD) and a price. Null when the record gives no price for it. */
  lastSale: { date: string; price: number } | null;
  /** The day of the last recorded sale, with or without a price: some records give the day a house sold and not what for. */
  soldOn: string | null;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const clean = v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
};
const within = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
/** A count a record gives as 0 when it does not know it (bedrooms, bathrooms, living area, lot). */
const positive = (v: unknown, min: number, max: number): number | null => {
  const n = within(v, min, max);
  return n !== null && n > 0 ? n : null;
};

const THIS_YEAR = new Date().getUTCFullYear();

/** One record of an answer, reduced to what flip uses. Null when it does not say where the property is. */
export function recordFrom(raw: unknown): PropertyRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 200);
  const address = text(r.formattedAddress, 300);
  const lat = within(r.latitude, -90, 90);
  const lng = within(r.longitude, -180, 180);
  if (!id || !address || lat === null || lng === null) return null;

  const features = r.features && typeof r.features === "object" && !Array.isArray(r.features) ? (r.features as Record<string, unknown>) : {};
  const spaces = within(features.garageSpaces, 0, 20);
  const garage = spaces !== null ? spaces : features.garage === false ? 0 : null;

  const soldOn = typeof r.lastSaleDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.lastSaleDate) && !Number.isNaN(Date.parse(r.lastSaleDate)) ? r.lastSaleDate.slice(0, 10) : null;
  const soldFor = positive(r.lastSalePrice, 1, 1_000_000_000);
  const zip = text(r.zipCode, 10);

  return {
    id,
    address,
    lat,
    lng,
    zip: zip && /^\d{5}$/.test(zip) ? zip : null,
    county: text(r.county, 80),
    propertyType: text(r.propertyType, 40),
    sqft: positive(r.squareFootage, 100, 50_000),
    lotSqft: positive(r.lotSize, 1, 50_000_000),
    beds: positive(r.bedrooms, 0, 30),
    baths: positive(r.bathrooms, 0, 30),
    yearBuilt: within(r.yearBuilt, 1700, THIS_YEAR + 2),
    garage,
    lastSale: soldOn && soldFor !== null ? { date: soldOn, price: soldFor } : null,
    soldOn,
  };
}

/** Under this a recorded "price" is a fee or a token sum on a deed, not what a house sold for. */
const MIN_SALE_PRICE = 10_000;

/**
 * A record as a sold home the engine can compare with, or null when it
 * cannot be one: no living area, no real sale on record, or a sale from
 * before the house was built. Its condition is unknown; a public record does
 * not say it.
 */
export function saleFrom(record: PropertyRecord): Sale | null {
  if (record.sqft === null || !record.lastSale || record.lastSale.price < MIN_SALE_PRICE) return null;
  // A sale dated before the year the house was built was a sale of something else: the lot, or the house that
  // stood there before. Its price says nothing about this one.
  if (record.yearBuilt !== null && Number(record.lastSale.date.slice(0, 4)) < record.yearBuilt) return null;
  return {
    id: record.id,
    address: record.address,
    lat: record.lat,
    lng: record.lng,
    submarket: record.zip ?? "zip not on record",
    sqft: record.sqft,
    lotSqft: record.lotSqft,
    beds: record.beds,
    baths: record.baths,
    yearBuilt: record.yearBuilt,
    garage: record.garage,
    condition: "unknown",
    price: record.lastSale.price,
    saleDate: record.lastSale.date,
  };
}

export interface SalesQuery {
  lat: number;
  lng: number;
  radiusMiles: number;
  /** Sold within this many days of today. */
  days: number;
  /** Living area, from and to. */
  sqft: [number, number];
  propertyType: string;
}

const query = (params: Record<string, string>) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export function propertyUrl(base: string, address: string): string {
  return `${base}/properties?${query({ address })}`;
}

export function salesUrl(base: string, q: SalesQuery): string {
  return `${base}/properties?${query({
    latitude: q.lat.toFixed(6),
    longitude: q.lng.toFixed(6),
    radius: String(q.radiusMiles),
    propertyType: q.propertyType,
    saleDateRange: `*:${Math.max(1, Math.round(q.days))}`,
    squareFootage: `${Math.round(q.sqft[0])}:${Math.round(q.sqft[1])}`,
    limit: String(RENTCAST_PAGE),
    includeTotalCount: "true",
  })}`;
}

export interface RentcastReply {
  status: number;
  records: PropertyRecord[];
  /** How many records the answer held, readable or not. */
  returned: number;
  /** How many records match in all, when the answer says (it returns 500 at most). */
  total: number | null;
  /** True when a 200 came back that could not be read as a list of records. It was billed all the same. */
  garbled?: boolean;
}

/**
 * No answer came back: the request timed out, the connection failed, or the
 * answer was a redirect. Whether it was billed is not known. It carries the
 * kind of failure and nothing else: what a failed request says about itself
 * can quote its own headers, and one of those is the key.
 */
export class NoAnswer extends Error {
  /** "TimeoutError", "TypeError" and the like. */
  readonly why: string;
  constructor(cause: unknown) {
    super("RentCast did not answer.");
    this.name = "NoAnswer";
    this.why = cause instanceof Error ? cause.name : "error";
  }
}

/**
 * How a request is sent: with the key in a header, never from a cache, and
 * never following a redirect (a redirect would carry the key to wherever it
 * points).
 */
export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "error"; cache: "no-store" }) => Promise<Response>;

const MAX_ANSWER_BYTES = 12_000_000;

async function bodyText(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One request. Any status comes back as a reply (only 200 is billed); a
 * request that got no answer throws NoAnswer. The key travels in a header
 * and appears nowhere else: not in the address, not in an error.
 */
export async function askRentcast(url: string, key: string, fetcher: Fetcher = fetch, timeoutMs = 15_000): Promise<RentcastReply> {
  let res: Response;
  let body: string | null;
  // One deadline for the whole exchange, the reading of the answer included. A timer of its own, cleared the
  // moment the answer is in: AbortSignal.timeout leaves its timer to the garbage collector, and Node 20 can
  // spin forever cleaning those up as a process exits.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(Object.assign(new Error("RentCast took too long to answer."), { name: "TimeoutError" })), timeoutMs);
  try {
    res = await fetcher(url, { headers: { "x-api-key": key, accept: "application/json" }, signal: deadline.signal, redirect: "error", cache: "no-store" });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, records: [], returned: 0, total: null };
    }
    body = await Promise.race([bodyText(res, MAX_ANSWER_BYTES), new Promise<never>((_, reject) => deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason), { once: true }))]);
  } catch (err) {
    throw new NoAnswer(err);
  } finally {
    clearTimeout(timer);
  }
  let parsed: unknown;
  try {
    parsed = body === null ? null : JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return { status: 200, records: [], returned: 0, total: null, garbled: true };
  const records = parsed.flatMap((raw) => recordFrom(raw) ?? []);
  const header = res.headers.get("x-total-count");
  const counted = header === null || header.trim() === "" ? NaN : Number(header);
  return { status: 200, records, returned: parsed.length, total: Number.isInteger(counted) && counted >= 0 ? counted : null };
}
