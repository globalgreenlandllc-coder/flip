import { haversineMiles } from "../engine/math.ts";
import type { Fetcher } from "./rentcast.ts";

/**
 * A stand-in for RentCast's API, for tests: records in the shape its
 * /properties endpoint answers with, and a fetcher that answers the two
 * questions flip asks the way the real one does (one address; the sold homes
 * around a point, 500 at most, in no particular order, with the full count
 * in a header).
 *
 * Every address, name and number here is made up. No real record is in the
 * repository: the shape was taken from six real answers read on 2026-11-24,
 * and each record carries an owner block the way the real ones do, so the
 * tests can show that it never gets past the reader.
 */

/** The day the tests run on. */
export const TODAY = new Date("2026-11-10T10:00:00.000Z");
/** The day "sold N days ago" is counted back from. The tests' day, unless a stand-in server sets the real one. */
let today = TODAY;
export function fixturesToday(day: Date): void {
  today = day;
}
export const HOME = { lat: 47.1, lng: -122.3 };
export const SUBJECT_ADDRESS = "4821 Orchard Loop Rd, Fixture Falls, WA 98000";

const MILE_LAT = 1 / 69.0;
const MILE_LNG = 1 / (69.17 * Math.cos((HOME.lat * Math.PI) / 180));

export interface Made {
  /** Miles north and east of HOME. */
  north?: number;
  east?: number;
  address?: string;
  propertyType?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFootage?: number | null;
  lotSize?: number | null;
  yearBuilt?: number | null;
  /** Null: a record that does not give its zip code. */
  zipCode?: string | null;
  /** Sold this many days before the fixtures' day, for this much. Left out: never sold. A price of 0: a sale on record with its day and no price, as in the states that do not publish prices. */
  soldDaysAgo?: number;
  soldFor?: number;
  garageSpaces?: number;
  garage?: boolean;
}

const dayBefore = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10) + "T00:00:00.000Z";

/** One record, RentCast's way. */
export function record(n: number, made: Made = {}): Record<string, unknown> {
  const address = made.address ?? `${100 + n} Sample St, Fixture Falls, WA ${made.zipCode ?? "98000"}`;
  const sold = made.soldDaysAgo !== undefined && made.soldFor !== undefined ? { lastSaleDate: dayBefore(made.soldDaysAgo), lastSalePrice: made.soldFor } : {};
  const field = <T,>(given: T | null | undefined, fallback: T): T | undefined => (given === null ? undefined : (given ?? fallback));
  return {
    id: address.replace(/,? /g, "-"),
    formattedAddress: address,
    addressLine1: address.split(",")[0],
    city: "Fixture Falls",
    state: "WA",
    zipCode: made.zipCode === null ? undefined : (made.zipCode ?? "98000"),
    county: "Sample",
    latitude: HOME.lat + (made.north ?? 0) * MILE_LAT,
    longitude: HOME.lng + (made.east ?? 0) * MILE_LNG,
    propertyType: made.propertyType ?? "Single Family",
    bedrooms: field(made.bedrooms, 3),
    bathrooms: field(made.bathrooms, 2),
    squareFootage: field(made.squareFootage, 1_800),
    lotSize: field(made.lotSize, 7_200),
    yearBuilt: field(made.yearBuilt, 1984),
    assessorID: `00${n}`,
    legalDescription: "LOT 1 OF A PLAT THAT DOES NOT EXIST",
    ...sold,
    features: { floorCount: 1, heating: true, ...(made.garageSpaces !== undefined ? { garage: true, garageSpaces: made.garageSpaces } : made.garage !== undefined ? { garage: made.garage } : { garage: true }) },
    taxAssessments: { "2025": { year: 2025, value: 480_000, land: 150_000, improvements: 330_000 } },
    propertyTaxes: { "2025": { year: 2025, total: 5_200 } },
    history: made.soldDaysAgo !== undefined ? { [dayBefore(made.soldDaysAgo).slice(0, 10)]: { event: "Sale", date: dayBefore(made.soldDaysAgo), price: made.soldFor } } : {},
    // What a real answer carries and flip must never keep.
    owner: { names: ["Pat Madeup"], type: "Individual", mailingAddress: { formattedAddress: "PO Box 7, Nowhere, WA 98000" } },
    ownerOccupied: true,
  };
}

/** The house the tests are about: 1,800 sqft, 3 bed 2 bath, built 1984, on 7,200 sqft, last sold in 2019. */
export const subjectRecord = (made: Made = {}) => record(0, { address: SUBJECT_ADDRESS, soldDaysAgo: 2_600, soldFor: 365_000, ...made });

/**
 * `count` sold homes like the subject, spread inside `withinMiles` and
 * `withinDays`, around `price`. Deterministic. `around`: miles north and
 * east of HOME that they are spread about, for a second neighbourhood.
 */
export function soldHomes(
  count: number,
  opts: { withinMiles?: number; fromMiles?: number; withinDays?: number; fromDays?: number; price?: number; start?: number; around?: { north: number; east: number }; made?: Made } = {},
): Record<string, unknown>[] {
  const { withinMiles = 0.9, fromMiles = 0.05, withinDays = 330, fromDays = 20, price = 520_000, start = 1, around = { north: 0, east: 0 } } = opts;
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) / count;
    const miles = fromMiles + (withinMiles - fromMiles) * Math.sqrt(t);
    const angle = i * 2.399963; // the golden angle: no two on one line
    return record(start + i, {
      north: around.north + miles * Math.cos(angle),
      east: around.east + miles * Math.sin(angle),
      squareFootage: 1_800 + ((i * 37) % 300) - 150,
      soldDaysAgo: Math.round(fromDays + ((i * 53) % Math.max(1, withinDays - fromDays))),
      soldFor: Math.round(price * (0.94 + ((i * 29) % 13) / 100)),
      ...opts.made,
    });
  });
}

export interface Call {
  kind: "property" | "sales" | "listings" | "area-sales";
  url: string;
  params: Record<string, string>;
  key: string | null;
  /** How the request was sent: never following a redirect, never from a cache. */
  redirect: string;
  cache: string;
}

export interface FakeRentcast {
  fetch: Fetcher;
  calls: Call[];
  /** What the next answers are instead of the records: a status, a body that is not a list, or no answer at all. */
  fail: { status?: number; garbled?: boolean; noAnswer?: boolean; only?: Call["kind"] } | null;
  /** Answer an address it does not have with the house nearest to it on the same street. Whether the real service ever does has not been seen: this is what the code must be safe against. */
  nearest: boolean;
  /** How long each answer takes, in milliseconds. */
  delayMs: number;
}

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** An address the way a service that places addresses reads it: "Rd." is "Road" is "rd", a comma more or less is nothing. */
const placed = (address: string) =>
  address
    .toLowerCase()
    .replace(/\b(\d{5})-\d{4}\b/, "$1")
    .replace(/[.,#]/g, " ")
    .replace(/\b(?:usa|united states)\b/g, " ")
    .replace(/\broad\b/g, "rd")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\s+/g, " ")
    .trim();

export interface ListingMade extends Made {
  /** Asked for it. */
  asking?: number;
  listingType?: string;
  /** On the market this many days. */
  daysOnMarket?: number;
}

/**
 * One home for sale, the way RentCast's sale listings give it. It carries the
 * listing agent's and office's names, phones and e-mails, as the real ones
 * do, so the tests can show that none of it gets past the reader.
 */
export function listing(n: number, made: ListingMade = {}): Record<string, unknown> {
  const base = record(n, made);
  const days = made.daysOnMarket ?? 12 + (n % 40);
  return {
    id: base.id,
    formattedAddress: base.formattedAddress,
    addressLine1: base.addressLine1,
    city: base.city,
    state: base.state,
    zipCode: base.zipCode,
    county: base.county,
    latitude: base.latitude,
    longitude: base.longitude,
    propertyType: base.propertyType,
    bedrooms: base.bedrooms,
    bathrooms: base.bathrooms,
    squareFootage: base.squareFootage,
    lotSize: base.lotSize,
    yearBuilt: base.yearBuilt,
    status: "Active",
    price: made.asking ?? 450_000,
    listingType: made.listingType ?? "Standard",
    listedDate: dayBefore(days),
    removedDate: null,
    createdDate: dayBefore(days),
    lastSeenDate: dayBefore(0),
    daysOnMarket: days,
    mlsName: "FixtureMLS",
    mlsNumber: `F${100_000 + n}`,
    listingAgent: { name: "Robin Madeup", phone: "5550100", email: "robin@madeup.invalid", website: "https://agent.invalid" },
    listingOffice: { name: "Madeup Realty", phone: "5550101", email: "office@madeup.invalid", website: "https://office.invalid" },
    history: { [dayBefore(days).slice(0, 10)]: { event: "Sale Listing", price: made.asking ?? 450_000, listingType: made.listingType ?? "Standard", listedDate: dayBefore(days), removedDate: null, daysOnMarket: days } },
  };
}

export function fakeRentcast(records: Record<string, unknown>[], listings: Record<string, unknown>[] = []): FakeRentcast {
  const fake: FakeRentcast = {
    calls: [],
    fail: null,
    nearest: false,
    delayMs: 0,
    fetch: async (url, init) => {
      const u = new URL(url);
      const params = Object.fromEntries(u.searchParams.entries());
      const kind: Call["kind"] = u.pathname.endsWith("/listings/sale") ? "listings" : params.address !== undefined ? "property" : params.zipCode !== undefined ? "area-sales" : "sales";
      fake.calls.push({ kind, url, params, key: init.headers["x-api-key"] ?? null, redirect: init.redirect, cache: init.cache });
      if (fake.delayMs) await new Promise((done) => setTimeout(done, fake.delayMs));
      const failing = fake.fail && (!fake.fail.only || fake.fail.only === kind) ? fake.fail : null;
      if (failing?.noAnswer) throw new DOMException("The operation timed out.", "TimeoutError");
      if (failing?.status) return reply(failing.status, { status: failing.status, error: "test/refused", message: "refused by the test" });
      if (failing?.garbled) return reply(200, { message: "not a list" });
      const limit = Number(params.limit ?? 50);
      const offset = Number(params.offset ?? 0);
      const page = (matches: Record<string, unknown>[]) =>
        matches.length === 0 || offset >= matches.length
          ? reply(404, { status: 404, error: "resource/not-found", message: "No results" })
          : reply(200, matches.slice(offset, offset + limit), params.includeTotalCount === "true" ? { "x-total-count": String(matches.length), "x-limit": String(limit), "x-offset": String(offset) } : {});

      if (kind === "listings") {
        if (params.status !== "Active") return reply(400, { status: 400, error: "test/unexpected", message: "only active listings are asked for" });
        return page(listings.filter((l) => l.zipCode === params.zipCode && l.propertyType === params.propertyType));
      }
      if (!u.pathname.endsWith("/properties")) return reply(404, { status: 404, error: "not-found", message: "no such endpoint" });

      if (kind === "area-sales") {
        const days = Number(params.saleDateRange.split(":")[1]);
        return page(records.filter((r) => r.zipCode === params.zipCode && r.propertyType === params.propertyType && typeof r.lastSaleDate === "string" && (today.getTime() - Date.parse(r.lastSaleDate)) / 86_400_000 <= days));
      }

      if (kind === "property") {
        const wanted = placed(params.address);
        const found = records.filter((r) => placed(String(r.formattedAddress)) === wanted);
        if (found.length) return reply(200, found);
        if (fake.nearest) {
          // The same street (everything after the number), the nearest number on it.
          const [, number, street] = wanted.match(/(\d+)\s+(.*?)(?:\s+\d{5})?$/) ?? [];
          const onStreet = records.filter((r) => placed(String(r.formattedAddress)).replace(/^\d+\s+/, "").startsWith(street?.split(" fixture")[0] ?? "\u0000"));
          const near = onStreet.sort((a, b) => Math.abs(parseInt(String(a.formattedAddress), 10) - Number(number)) - Math.abs(parseInt(String(b.formattedAddress), 10) - Number(number)))[0];
          if (near) return reply(200, [near]);
        }
        return reply(404, { status: 404, error: "resource/not-found", message: "No results" });
      }

      const [lat, lng, radius] = [Number(params.latitude), Number(params.longitude), Number(params.radius)];
      const days = Number(params.saleDateRange.split(":")[1]);
      const [lo, hi] = params.squareFootage.split(":").map(Number);
      const matches = records.filter((r) => {
        if (r.propertyType !== params.propertyType || typeof r.lastSaleDate !== "string") return false;
        const size = r.squareFootage as number | undefined;
        if (size === undefined || size < lo || size > hi) return false;
        if ((today.getTime() - Date.parse(r.lastSaleDate)) / 86_400_000 > days) return false;
        return haversineMiles(lat, lng, r.latitude as number, r.longitude as number) <= radius;
      });
      if (matches.length === 0) return reply(404, { status: 404, error: "resource/not-found", message: "No results" });
      // No stated order: the far ones first, so a reader that took "the first 500" for "the nearest 500" is caught.
      const ordered = [...matches].sort((a, b) => haversineMiles(lat, lng, b.latitude as number, b.longitude as number) - haversineMiles(lat, lng, a.latitude as number, a.longitude as number));
      return reply(200, ordered.slice(0, limit), params.includeTotalCount === "true" ? { "x-total-count": String(matches.length), "x-limit": String(limit), "x-offset": "0" } : {});
    },
  };
  return fake;
}
