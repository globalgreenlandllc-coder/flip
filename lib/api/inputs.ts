import { z } from "zod";
import type { DealInputs, PropertyFacts, Sale } from "@/lib/engine/types";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import { IMAGE_MEDIA_TYPES, sniffImage, type ImageMediaType } from "@/lib/vision/image-type";

/**
 * What the two API routes accept. Everything a caller sends is checked here
 * before it reaches the engine or the AI: a number that is not a number, a
 * rate of 4000%, a "photo" that is not an image are answered with a 400 that
 * names the field in plain words, never passed on.
 */

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** A number named in plain words, inside a range. */
function num(label: string, min: number, max: number, opts: { above?: boolean } = {}) {
  const base = z.number({ error: `${label} must be a number.` });
  const lower = opts.above ? base.gt(min, { error: `${label} must be above ${min.toLocaleString("en-US")}.` }) : base.min(min, { error: `${label} cannot be below ${min.toLocaleString("en-US")}.` });
  return lower.max(max, { error: `${label} cannot be above ${max.toLocaleString("en-US")}.` });
}

const THIS_YEAR = new Date().getUTCFullYear();
const MAX_MONEY = 100_000_000;

const financing = z
  .object({
    rate: num("Loan rate", 0, 1),
    ltc: num("Loan-to-cost", 0, 1),
    points: num("Loan points", 0, 0.2),
  })
  .partial();

const dealOverrides = z
  .object({
    askingPrice: num("Asking price", 0, MAX_MONEY, { above: true }),
    rehab: num("Rehab", 0, MAX_MONEY),
    hiddenRiskReserve: num("Hidden-risk reserve", 0, 1),
    holdingMonths: num("Hold (months)", 0, 60),
    monthlyHolding: num("Monthly holding cost", 0, 1_000_000),
    financing,
    closingBuyPct: num("Closing cost on the purchase", 0, 0.5),
    closingSellPct: num("Closing cost on the sale", 0, 0.5),
    targetProfit: num("Target profit", 0, MAX_MONEY),
  })
  .partial();

const houseNumbers = {
  sqft: num("Living area", 100, 50_000),
  lotSqft: num("Lot size", 0, 50_000_000),
  beds: num("Bedrooms", 0, 30),
  baths: num("Bathrooms", 0, 30),
  yearBuilt: num("Year built", 1700, THIS_YEAR + 2),
  garage: num("Garage spaces", 0, 20),
};

type HouseNumber = keyof typeof houseNumbers;
const HOUSE_NUMBERS = Object.keys(houseNumbers) as HouseNumber[];

const condition = z.enum(["distressed", "dated", "average", "updated", "renovated"], { error: "Condition must be distressed, dated, average, updated or renovated." });

/** A whole property, for callers of the numbers-only route who bring their own facts. */
const fullSubject = z.object({
  id: z.string({ error: "The property needs an id." }).min(1).max(200),
  lat: num("Latitude", -90, 90),
  lng: num("Longitude", -180, 180),
  submarket: z.string({ error: "The property needs a submarket." }).min(1).max(200),
  ...houseNumbers,
  condition,
});

const isoDate = z.string({ error: "Dates are written YYYY-MM-DD." }).refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()), { error: "Dates are written YYYY-MM-DD." });

const sale = fullSubject.extend({ price: num("Sale price", 0, MAX_MONEY, { above: true }), saleDate: isoDate });

function firstProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The request could not be read.";
  // Messages written above already name their field; zod's own are prefixed with where they happened.
  return /^[A-Z]/.test(issue.message) && !issue.message.startsWith("Invalid") && !issue.message.startsWith("Too ") ? issue.message : `${issue.path.join(".") || "request"}: ${issue.message}`;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InputError(firstProblem(result.error));
  return result.data;
}

export type DealOverrides = Omit<Partial<DealInputs>, "financing"> & { financing?: Partial<DealInputs["financing"]> };

export function readDeal(value: unknown): DealOverrides {
  if (value === undefined || value === null) return {};
  return parse(dealOverrides, value);
}

/** Defaults with the caller's overrides on top; financing is merged field by field so a lone rate keeps the default loan-to-cost and points. */
export function mergeDeal<T extends { financing: DealInputs["financing"] }>(defaults: T, overrides: DealOverrides): T & DealOverrides {
  return { ...defaults, ...overrides, financing: { ...defaults.financing, ...overrides.financing } };
}

/**
 * The facts a listing page can correct on an analysis: size, beds, baths and
 * the like. Location, id and condition are never taken from the caller here.
 *
 * Lenient on purpose. These numbers are read off a page by a parser, not
 * typed by the person, and the form has no field to correct them in: one
 * that is not a sane number is left out (the provider's fact stands), not
 * thrown back as an error nobody can act on.
 */
export function readFactOverrides(value: unknown): Partial<Pick<PropertyFacts, HouseNumber>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const given = value as Record<string, unknown>;
  const facts: Partial<Pick<PropertyFacts, HouseNumber>> = {};
  for (const key of HOUSE_NUMBERS) {
    const result = houseNumbers[key].safeParse(given[key]);
    if (result.success) facts[key] = result.data;
  }
  return facts;
}

export function readSubject(value: unknown): PropertyFacts {
  return parse(fullSubject, value);
}

export const MAX_OWN_SALES = 5_000;

export function readSales(value: unknown): Sale[] {
  if (!Array.isArray(value)) throw new InputError("`sales` must be a list of sold properties.");
  if (value.length > MAX_OWN_SALES) throw new InputError(`At most ${MAX_OWN_SALES.toLocaleString("en-US")} sales per request.`);
  return value.map((s, i) => {
    const result = sale.safeParse(s);
    if (!result.success) throw new InputError(`Sale ${i + 1}: ${firstProblem(result.error)}`);
    return result.data;
  });
}

export function readAsOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return parse(isoDate, value);
}

export function readText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new InputError(`${label} must be text.`);
  if (value.length > max) throw new InputError(`${label} is too long.`);
  return value;
}

/**
 * A link as the URL parser reads it, or null if it is not an http(s) link.
 * Parsed, not pattern-matched: a link with a space in it ("…/Front Porch.jpg")
 * is still a link, and comes back in the form it will be fetched in.
 */
function webAddress(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2_000) return null;
  try {
    const parsed = new URL(u.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
const someText = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);

/**
 * A listing the caller's own browser read (the extension, or a pasted page).
 * Its link must be a web address. Everything else was read off a page by a
 * parser, so it is kept when it is sane and left out when it is not: long
 * text is cut, a number out of range or a photo link that is not a link is
 * dropped. The person cannot fix a parser's mistake, and the
 * analysis can go on without that field.
 */
export function readListing(value: unknown, maxPhotos: number): ListingInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("`listing` must be an object.");
  const l = value as Record<string, unknown>;
  const url = webAddress(l.url);
  if (!url) throw new InputError("`listing.url` must be the listing's web address.");
  const host = someText(l.host, 255) ?? new URL(url).hostname.replace(/^www\./, "");
  const number = (schema: z.ZodType<number>, v: unknown) => {
    const result = schema.safeParse(v);
    return result.success ? result.data : undefined;
  };
  return {
    url,
    host,
    fetched: l.fetched === true,
    note: someText(l.note, 500),
    title: someText(l.title, 500),
    address: someText(l.address, 500),
    price: number(num("Listing price", 0, MAX_MONEY, { above: true }), l.price),
    beds: number(houseNumbers.beds, l.beds),
    baths: number(houseNumbers.baths, l.baths),
    sqft: number(houseNumbers.sqft, l.sqft),
    photos: (Array.isArray(l.photos) ? l.photos : []).flatMap((photo) => webAddress(photo) ?? []).slice(0, maxPhotos),
  };
}

/** Vercel caps a request body at 4.5 MB; nothing larger than that can be one honest photo. */
const MAX_UPLOAD_BASE64 = 6_200_000;
const MAX_PHOTO_ENTRIES = 60;

export type PhotoIn = { url: string } | { base64: string; mediaType: ImageMediaType };

/**
 * Uploaded photos and photo links. An upload must be the kind of image it
 * says it is, and one that is not is an error: it is the person's own file.
 * A photo link that is not a web address is left out without a word: the
 * links are collected off a page by a parser, and one odd `src` among thirty
 * must not sink the analysis.
 */
export function readPhotos(value: unknown): PhotoIn[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InputError("`photos` must be a list.");
  if (value.length > MAX_PHOTO_ENTRIES) throw new InputError(`At most ${MAX_PHOTO_ENTRIES} photos per request.`);
  return value.flatMap((p, i): PhotoIn[] => {
    const n = i + 1;
    if (!p || typeof p !== "object") throw new InputError(`Photo ${n} could not be read.`);
    const { url, base64, mediaType } = p as { url?: unknown; base64?: unknown; mediaType?: unknown };
    if (base64 === undefined && url !== undefined) return [webAddress(url)].flatMap((link) => (link ? [{ url: link }] : []));
    if (typeof base64 !== "string" || !IMAGE_MEDIA_TYPES.includes(mediaType as ImageMediaType)) throw new InputError(`Photo ${n} must be a JPEG, PNG, WebP or GIF image.`);
    if (base64.length > MAX_UPLOAD_BASE64) throw new InputError(`Photo ${n} is too large.`);
    if (base64.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new InputError(`Photo ${n} could not be read.`);
    const kind = sniffImage(Buffer.from(base64.slice(0, 24), "base64"));
    if (!kind) throw new InputError(`Photo ${n} is not a JPEG, PNG, WebP or GIF image.`);
    // Trust the file over the label: a PNG sent as image/jpeg is still a PNG.
    return [{ base64, mediaType: kind }];
  });
}
