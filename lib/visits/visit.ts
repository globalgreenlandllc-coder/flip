/**
 * A page seen, as the admin page counts it (app/api/visit/route.ts writes it, model Visit keeps it).
 *
 * What is kept, and what is not:
 *   - the page's path, with any id in it replaced, never its query string;
 *   - the city, region and country Vercel reads from the visitor's internet address, and the middle of that city;
 *   - the host of the site the visitor came from, when it is another site;
 *   - whether it was the owner (an admin, lib/admin/access.ts), so the owner's own visits can be left out; nobody
 *     else's account is kept;
 *   - a fingerprint of the address and the browser, made with a random key of the day that is thrown away when the
 *     day is over (lib/visits/keep.ts): one visitor is counted once a day, and once the key is gone the fingerprint
 *     cannot be worked back to an address, nor matched with another day's. The address itself is never kept, and no
 *     cookie is set.
 * Visits are kept KEEP_DAYS, then deleted.
 *
 * Pure: the rules. The route reads the request and writes the row.
 */
import { createHmac } from "node:crypto";
import { AREA_TIME_ZONE } from "../area";

/** One visitor's pages kept in a day. Past it nothing more of theirs is kept that day. */
export const MAX_VISITS_A_DAY = 300;

/**
 * One internet address's pages kept in a day, whatever browser names come from it: a script that names its browser
 * anew on every request makes a new visitor each time, and this stops it. Higher than one visitor's, for an office
 * or a household behind one address.
 */
export const MAX_VISITS_AN_ADDRESS = 1_000;

/**
 * Pages kept from everyone together in any 24 hours, past which none is kept: the last stop for a script that
 * changes its address too, so the table cannot fill. The admin page says when it was reached. FLIP_VISITS_PER_DAY.
 */
export const DEFAULT_VISITS_PER_DAY = 20_000;

export function visitsPerDay(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.FLIP_VISITS_PER_DAY);
  return env.FLIP_VISITS_PER_DAY?.trim() && Number.isInteger(n) && n >= 0 ? n : DEFAULT_VISITS_PER_DAY;
}

/** How long a visit is kept: a little over a year. */
export const KEEP_DAYS = 400;

/** The longest message the page sends: a path and where the visitor came from. */
export const MAX_BODY = 2_048;

// One for all calls: making it is slow (a page of 50,000 visits asks for it twice a row).
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: AREA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-11-27": the day on the area's clock. */
export function areaDay(at: Date): string {
  return DAY_FORMAT.format(at);
}

/** A word of a path kept as it is: lower case, short, and not an id (an id is long and has a digit in it). */
const plainWord = (seg: string) => /^[a-z][a-z0-9-]{0,39}$/.test(seg) && !(seg.length >= 12 && /\d/.test(seg));

/**
 * The page's path as kept: no query, no fragment, no trailing slash, at most six parts; a part that is not a plain
 * word (a saved deal's id, a token) becomes "[id]", so nothing a person typed or saved is kept and the pages add up.
 */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.length > 500) return null;
  const parts = raw.split(/[?#]/)[0].split("/").filter(Boolean).slice(0, 6);
  return `/${parts.map((seg) => (plainWord(seg) ? seg : "[id]")).join("/")}`;
}

export interface Place {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

const NOWHERE: Place = { country: null, region: null, city: null, lat: null, lng: null };

function headerText(value: string | null, max: number): string | null {
  if (!value) return null;
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    // Kept as sent.
  }
  text = text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text && text.length <= max ? text : null;
}

function coordinate(value: string | null, limit: number): number | null {
  if (!value || !/^-?\d{1,3}(\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 100) / 100 : null;
}

/**
 * Where Vercel says the visitor is, from the headers it adds (vercel.com/docs/headers/request-headers): the city of
 * the internet address and that city's middle, rounded to about a kilometre. Off Vercel there are none, and the
 * visit has no place. A value that is not what Vercel sends is dropped.
 */
export function placeFromHeaders(get: (name: string) => string | null): Place {
  const country = headerText(get("x-vercel-ip-country"), 2);
  const region = headerText(get("x-vercel-ip-country-region"), 3);
  const city = headerText(get("x-vercel-ip-city"), 80);
  const lat = coordinate(get("x-vercel-ip-latitude"), 90);
  const lng = coordinate(get("x-vercel-ip-longitude"), 180);
  const both = lat !== null && lng !== null && !(lat === 0 && lng === 0);
  const place: Place = {
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    region: region && /^[A-Z0-9]{1,3}$/.test(region) ? region : null,
    city,
    lat: both ? lat : null,
    lng: both ? lng : null,
  };
  return Object.values(place).every((v) => v === null) ? NOWHERE : place;
}

const ownRoot = (host: string | null) => (host ?? "").toLowerCase().split(":")[0].replace(/^www\./, "");

/**
 * The site the visitor came from: its host, when it is another site. This site's own pages and its sign-in pages
 * (Clerk's, on accounts.dev or on a part of this domain) are not "another site".
 */
export function referrerHost(ref: unknown, ownHost: string | null): string | null {
  if (typeof ref !== "string" || !ref || ref.length > 1_000) return null;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const own = ownRoot(ownHost);
  if (!host || host.length > 100) return null;
  if (own && (host === own || host.endsWith(`.${own}`))) return null;
  if (host === "accounts.dev" || host.endsWith(".accounts.dev")) return null;
  return host;
}

/**
 * Programs that fetch pages, and browsers driven by one. They are not visitors. (The apps that draw a link's preview
 * do not run the page, so they never report a visit; their names are not listed, because a person reading in such an
 * app's own browser carries the app's name too: "Telegram-Android".)
 */
const PROGRAM = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|curl|wget|python|go-http|node-fetch|undici|axios|java\/|okhttp|postman|insomnia/i;

export function looksLikeAProgram(userAgent: string | null): boolean {
  return !userAgent || userAgent.length < 20 || PROGRAM.test(userAgent);
}

/** The visitor's internet address, as Vercel passes it on: the first of x-forwarded-for, else x-real-ip. Used for the fingerprint only. */
export function clientAddress(get: (name: string) => string | null): string {
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || get("x-real-ip")?.trim() || "").slice(0, 100);
}

/**
 * One visitor's fingerprint for the day: a keyed one-way sum of the address and the browser, the key being the day's
 * random key (lib/visits/keep.ts). While the key exists, the same visitor gets the same fingerprint all day; once it
 * is thrown away, nobody can try addresses against the fingerprints, and the next day's key gives the same person
 * another one.
 */
export function visitorId(dayKey: string, address: string, userAgent: string): string {
  return createHmac("sha256", dayKey).update(`${address}\n${userAgent}`).digest("hex").slice(0, 32);
}

/** The same for the address alone (MAX_VISITS_AN_ADDRESS): never equal to a visitor's fingerprint, and as one-way once the key is gone. */
export function addressId(dayKey: string, address: string): string {
  return createHmac("sha256", dayKey).update(`address\n${address}`).digest("hex").slice(0, 32);
}

/**
 * Whether the message came from one of this site's own pages. A browser says so itself (Sec-Fetch-Site); one too old
 * to say so is believed when the page's origin is this host.
 */
export function fromOwnPage(get: (name: string) => string | null): boolean {
  const site = get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = get("origin");
  const host = get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
