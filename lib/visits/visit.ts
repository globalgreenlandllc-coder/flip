/**
 * A page seen, as the admin pages count it (app/api/visit/route.ts writes it, model Visit keeps it).
 *
 * What is kept, and what is not:
 *   - the page's path, with any id in it replaced, never its query string;
 *   - on the first page of a visit, the link's campaign tags (utm_source, utm_medium, utm_campaign, utm_content),
 *     short and cleaned, none that looks like an identifier; which network's click id it carried and whether that
 *     id is one only paid ads get, never the id itself;
 *   - the city, region and country Vercel reads from the visitor's internet address, and the middle of that city;
 *   - the host of the site the visitor came from, when it is another site;
 *   - the kind of device and a short name of the browser or app, read from the browser's name, which is not kept;
 *   - whether someone was signed in, and if so their account: the owner chose on 2026-11-27 to see who did what
 *     when signed in. A visitor who is not signed in has no account on the row;
 *   - whether it was the owner (an admin, lib/admin/access.ts), so the owner's own visits can be left out;
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
import { CLICK_IDS } from "./click-ids";

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

/** The longest message the page sends: a path, where the visitor came from, and the link's campaign tags. */
export const MAX_BODY = 4_096;

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

/** The campaign tags a link carried, as kept: each short, cleaned, or null. */
export interface Campaign {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  /** The network whose click id the link carried ("facebook", "google"…); never the id. */
  clickFrom: string | null;
  /** The link carried a click id that only a paid ad gets. Facebook's fbclid is not one: Facebook adds it to every link. */
  adClick: boolean;
}

export const NO_CAMPAIGN: Campaign = { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, clickFrom: null, adClick: false };

const NETWORKS = new Set(CLICK_IDS.map((c) => c.network));

const UUID = /[0-9a-f]{8}[-_]?[0-9a-f]{4}[-_]?[0-9a-f]{4}[-_]?[0-9a-f]{4}[-_]?[0-9a-f]{12}/i;

/**
 * Whether a tag looks like a person's or a click's identifier rather than a campaign's name: an "@"; a UUID; a run of
 * 16 or more letters and digits with a digit in it; or, once "-" and "_" are taken out, such a run with 6 or more
 * digits ("id-1234-5678-9012-3456"). An ordinary name with a year in it ("spring-sale-2026-decks") is kept.
 */
export function looksLikeAnId(text: string): boolean {
  if (text.includes("@") || UUID.test(text)) return true;
  if ((text.match(/[A-Za-z0-9]{16,}/g) ?? []).some((run) => /\d/.test(run))) return true;
  return (text.replace(/[-_]/g, "").match(/[A-Za-z0-9]{16,}/g) ?? []).some((run) => (run.match(/\d/g) ?? []).length >= 6);
}

/**
 * One tag: printable, single-spaced, at most 100 characters; the source and medium in lower case. A tag that looks
 * like an identifier is dropped: campaign tags are kept to say which ad, never who.
 */
function tag(value: unknown, lower: boolean): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || looksLikeAnId(text)) return null;
  if (lower) text = text.toLowerCase();
  return text.slice(0, 100);
}

/** The campaign tags the page sent for the first page of a visit (components/visit-beacon.tsx). Anything else is dropped. */
export function campaignFrom(body: unknown): Campaign {
  if (!body || typeof body !== "object") return NO_CAMPAIGN;
  const b = body as { utm?: unknown; ad?: unknown; click?: unknown };
  const utm = b.utm && typeof b.utm === "object" ? (b.utm as Record<string, unknown>) : {};
  return {
    utmSource: tag(utm.source, true),
    utmMedium: tag(utm.medium, true),
    utmCampaign: tag(utm.campaign, false),
    utmContent: tag(utm.content, false),
    clickFrom: typeof b.click === "string" && NETWORKS.has(b.click) ? b.click : null,
    adClick: b.ad === true,
  };
}

/** "phone", "tablet" or "computer", from the browser's name. */
export function deviceOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  // An Android tablet's browser name has no "Mobile" anywhere in it (a phone's has, wherever "Android" sits).
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return "phone";
  return "computer";
}

/** A short name for the browser, or for the app whose own browser opened the page. */
export function browserOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const apps: [RegExp, string][] = [
    [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/, "Facebook app"],
    [/Instagram/, "Instagram app"],
    [/musical_ly|TikTok|BytedanceWebview|trill_/i, "TikTok app"],
    [/Snapchat/i, "Snapchat app"],
    [/LinkedInApp/i, "LinkedIn app"],
    [/Pinterest/i, "Pinterest app"],
    [/Telegram/i, "Telegram app"],
    [/\bLine\//, "LINE app"],
    [/WhatsApp/i, "WhatsApp"],
    [/GSA\//, "Google app"],
    [/SamsungBrowser/i, "Samsung Internet"],
    [/Edg(e|A|iOS)?\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/Firefox|FxiOS/, "Firefox"],
    [/CriOS|Chrome\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  return apps.find(([re]) => re.test(userAgent))?.[1] ?? "Other browser";
}
