/**
 * Best-effort listing metadata from a listing page's HTML or copied text.
 *
 * Reads the public Open Graph / meta tags and obvious text patterns only.
 * Pure parsing: this file is bundled for the browser too (the analyzer parses
 * a pasted page there). The server-side read of a link is read-listing.ts.
 */

import { HOUSE_NUMBER, STREET_WORD, UNIT_LINE, mentionsHouse, sameAddress, streetLine } from "./address";
import { MAX_HTML_CHARS, decodeEntities, jsonLd, pageText, scanTags } from "./html";
import { contradicts, factNumber, mergeFacts, readPage, readText, saneFact, withoutData, type FactSource, type ListingDescription, type ListingDetail, type ListingFacts } from "./listing-facts";
import { houseEnd, isParagraph } from "./zone";

/** How a listing page reached flip: read by the server, read through the person's browser (the extension), pasted in, or handed over by the button on the listing page. */
export type ListingVia = "server" | "browser" | "paste" | "button";
export const LISTING_VIAS: ListingVia[] = ["server", "browser", "paste", "button"];

export interface ListingInfo {
  /** The listing's link. Empty when a page was pasted without one. */
  url: string;
  host: string;
  fetched: boolean;
  note?: string;
  title?: string;
  address?: string;
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  photos: string[];
  /** The listing's own description, kept as written, and where on the page it was found. */
  description?: ListingDescription;
  /** Every fact the page gave, the five above included, each with where it was read (lib/listing/listing-facts.ts). */
  facts?: ListingFacts;
  /** Labelled lines of the page's detail sections, as written: "Sewer: Septic Tank". */
  details?: ListingDetail[];
  /** When the page was read, and how. `with`: the other ways it was read for what the first lacked (a pasted page whose photos the server fetched). */
  read?: { at: string; via: ListingVia; with?: ListingVia[] };
  /** Set when the pasted site blocked the server and the listing was read elsewhere. */
  readFrom?: { host: string; url: string; reason: string };
}

type Headline = { price?: number; beds?: number; baths?: number; sqft?: number; address?: string };
const HEADLINE = ["price", "beds", "baths", "sqft", "address"] as const;

/** The five readings the analysis has always used, as facts that say where each was read. */
function headlineFacts(own: Headline, source: FactSource | Partial<Record<keyof Headline, FactSource>>): ListingFacts {
  const facts: ListingFacts = {};
  for (const key of HEADLINE) {
    const fact = saneFact(key, { value: own[key], source: typeof source === "string" ? source : (source[key] ?? "text") });
    if (fact) facts[key] = fact;
  }
  return facts;
}

/** The same five back out of a listing's facts, so the line a person sees and the fact beside it are never two different numbers. */
function headlineOf(facts: ListingFacts): Headline {
  const address = facts.address?.value;
  return { price: factNumber(facts, "price"), beds: factNumber(facts, "beds"), baths: factNumber(facts, "baths"), sqft: factNumber(facts, "sqft"), address: typeof address === "string" ? address : undefined };
}

const someFacts = (facts: ListingFacts) => (Object.keys(facts).length ? facts : undefined);

/** The page's <meta> tags by property or name, lower-cased, each with its contents in page order. One scan of the page for all of them. */
function metaIndex(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const tag of scanTags(html, ["meta"], 2_000)) {
    const content = tag.attrs.get("content");
    if (!content) continue;
    for (const key of [tag.attrs.get("property"), tag.attrs.get("name")]) {
      if (!key || key.length > 80) continue;
      const list = out.get(key.toLowerCase()) ?? [];
      if (list.length < 400) list.push(decodeEntities(content));
      out.set(key.toLowerCase(), list);
    }
  }
  return out;
}

/** The page's title: the text after its first <title> tag, as far as the next tag. */
function titleOf(html: string): string | undefined {
  const tag = scanTags(html, ["title"], 1)[0];
  if (!tag) return undefined;
  const next = html.indexOf("<", tag.end);
  const text = decodeEntities(html.slice(tag.end, Math.min(next < 0 ? html.length : next, tag.end + 400))).replace(/\s+/g, " ").trim();
  return text || undefined;
}

const PHOTO_EXT = /\.(?:jpe?g|png|webp)(?:$|[?#])/i;
const NOT_A_LISTING_PHOTO = /(?:logo|icon|sprite|avatar|favicon|badge|agent|headshot|map|pixel|tracking|placeholder|blank|spacer|\/svg\/|novaimgs|\/static\/|\/assets\/)/i;
export const MAX_LISTING_PHOTOS = 16;
const MAX_PHOTO_CANDIDATES = 400;
const MAX_LINK_CHARS = 2_000;
/** Biggest candidate in a srcset ("url 320w, url 1024w" or "url 1x, url 2x"). */
function biggestInSrcset(srcset: string): string | undefined {
  let best: { url: string; size: number } | undefined;
  for (const part of srcset.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const size = d ? parseFloat(d) : 0;
    if (!best || size > best.size) best = { url: u, size };
  }
  return best?.url;
}

/**
 * Every listing photo the page exposes publicly: Open Graph and Twitter
 * tags, JSON-LD "image" fields, and gallery <img>/<source> elements. Filters
 * out logos, icons, maps and agent headshots. Order is preserved so the
 * cover photo comes first.
 */
export function extractPhotos(html: string, pageUrl: string, metas: Map<string, string[]> = metaIndex(html), ld: unknown[] = jsonLd(html)): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    // A listing has dozens of photos. A page offering thousands of "photos", or a link longer than any link, is not one.
    if (typeof raw !== "string" || !raw || raw.length > MAX_LINK_CHARS || found.length >= MAX_PHOTO_CANDIDATES) return;
    let u = decodeEntities(raw.trim());
    if (u.startsWith("//")) u = "https:" + u;
    else if (u.startsWith("/")) {
      try { u = new URL(u, pageUrl).toString(); } catch { return; }
    }
    if (!/^https?:\/\//.test(u)) return;
    if (NOT_A_LISTING_PHOTO.test(u)) return;
    if (!PHOTO_EXT.test(u) && !/(?:photo|image|img|picture|media|cdn)/i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    found.push(u);
  };

  for (const key of ["og:image", "og:image:secure_url", "twitter:image"]) for (const u of metas.get(key) ?? []) push(u);

  // JSON-LD: "image": "url" | ["url", ...] | {"url": ...}
  for (const block of ld) {
    try {
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        const obj = node as Record<string, unknown>;
        const urlOf = (i: unknown): unknown => (typeof i === "string" ? i : ((i as { url?: unknown } | null)?.url ?? (i as { contentUrl?: unknown } | null)?.contentUrl));
        for (const key of ["image", "photo", "photos", "contentUrl"]) {
          const img = obj[key];
          if (Array.isArray(img)) img.forEach((i) => push(urlOf(i)));
          else if (img) push(urlOf(img));
        }
        for (const v of Object.values(obj)) if (v && typeof v === "object") walk(v);
      };
      walk(block);
    } catch {
      /* nested past any page's need */
    }
  }

  // Gallery images. A gallery that loads its photos as they scroll into view keeps the real link
  // in a data- attribute and a placeholder in src, so the data- attributes are looked at first.
  for (const { attrs } of scanTags(html, ["img", "source"], 6_000)) {
    const srcset = attrs.get("srcset") ?? attrs.get("data-srcset");
    if (srcset) push(biggestInSrcset(srcset));
    const src = attrs.get("data-src") ?? attrs.get("data-lazy-src") ?? attrs.get("data-original") ?? attrs.get("src");
    if (src && !/^data:/.test(src)) push(src);
  }

  return dedupePhotos(found).slice(0, MAX_LISTING_PHOTOS);
}

/**
 * Listing CDNs serve every photo in several sizes and formats. Group by the
 * photo's identity (the hash on zillowstatic-style URLs, otherwise the path
 * with size tokens stripped) and keep the largest variant, jpg before webp.
 */
export function dedupePhotos(urls: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const u of urls) {
    const key = photoKey(u);
    const g = groups.get(key);
    if (g) g.push(u);
    else groups.set(key, [u]);
  }
  const out: string[] = [];
  for (const variants of groups.values()) {
    variants.sort((a, b) => sizeHint(b) - sizeHint(a) || (/\.jpe?g/i.test(a) ? -1 : 0) - (/\.jpe?g/i.test(b) ? -1 : 0));
    out.push(variants[0]);
  }
  return out;
}

function photoKey(u: string): string {
  const hash = u.match(/\/fp\/([0-9a-f]{32})/i)?.[1];
  if (hash) return hash;
  // Movoto: pi.movoto.com/p/<mls>/<id>_<n>_<hash>_<variant>.<ext>
  const mv = u.match(/pi\.movoto\.com\/p\/\d+\/(\d+_\d+_[A-Za-z0-9]+)_[a-z]\.(?:jpe?g|webp|png)/i);
  if (mv) return "movoto:" + mv[1];
  // Estately: images.estately.net/<mls>_<listing>_<n>_<stamp>[_WxH[a]].jpg
  const es = u.match(/images\.estately\.net\/([0-9]+_[A-Za-z0-9]+_\d+_\d+)(?:_\d+x\d+[a-z]?)?\.(?:jpe?g|webp|png)/i);
  if (es) return "estately:" + es[1];
  try {
    const path = new URL(u).pathname
      .replace(/\.(?:jpe?g|png|webp)$/i, "")
      .replace(/[-_](?:\d{2,4}x\d{2,4}|\d{3,4}w?|cc_ft_\d+|uncropped_scaled_within_\d+_\d+|[a-z]_[a-z]|@\dx|large|medium|small|thumb(?:nail)?)$/gi, "");
    return path;
  } catch {
    return u;
  }
}

/** Largest number that looks like a pixel size in the filename; 0 if none. */
function sizeHint(u: string): number {
  // Movoto variants: l (large) > r > p (preview) > t (thumb).
  const mv = u.match(/pi\.movoto\.com\/p\/\d+\/\d+_\d+_[A-Za-z0-9]+_([a-z])\./i);
  if (mv) return { l: 4000, r: 3000, p: 2000, t: 1000 }[mv[1]] ?? 0;
  // Estately: no size suffix means the original.
  if (/images\.estately\.net\//i.test(u) && !/_\d+x\d+[a-z]?\.(?:jpe?g|webp|png)$/i.test(u)) return 9000;
  // Drop a leading content hash (zillowstatic: "<32 hex>-variant.jpg") so its
  // digit runs are not mistaken for pixel sizes.
  const name = (u.split("/").pop() ?? "").replace(/^[0-9a-f]{32}-/i, "");
  const nums = (name.match(/\d{3,4}/g) ?? []).map(Number).filter((n) => n >= 200 && n <= 8000);
  return nums.length ? Math.max(...nums) : 0;
}

/** Price from JSON-LD offers ("offers": {"price": 699000}) when the page has it. */
export function priceFromJsonLd(html: string, ld: unknown[] = jsonLd(html)): number | undefined {
  for (const block of ld) {
    let found: number | undefined;
    const walk = (node: unknown) => {
      if (found !== undefined || !node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const obj = node as Record<string, unknown>;
      const offers = obj.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const price = offer && typeof offer === "object" ? Number((offer as Record<string, unknown>).price) : NaN;
      if (Number.isFinite(price) && price >= 20_000) { found = price; return; }
      for (const v of Object.values(obj)) if (v && typeof v === "object") walk(v);
    };
    try { walk(block); } catch { /* nested past any page's need */ }
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The asking price in the JSON a page ships with, when the page says one
 * price under the most telling key it has. A listing page carries prices for
 * the homes it suggests too, so "the first one found" is not a rule.
 */
function priceFromJson(html: string): number | undefined {
  const byKey = new Map<string, number[]>();
  let mentions = 0;
  for (const m of html.matchAll(/\\?"(listPrice|listingPrice|unformattedPrice|price)\\?"\s{0,2}:\s{0,2}\\?"?\$?(\d{1,3}(?:,\d{3}){1,2}|\d{4,9})(?!\d|,\d{3})/g)) {
    if (++mentions > 2_000) break;
    const list = byKey.get(m[1]) ?? [];
    list.push(Number(m[2].replace(/,/g, "")));
    byKey.set(m[1], list);
  }
  for (const key of ["listPrice", "listingPrice", "unformattedPrice", "price"]) {
    const list = byKey.get(key);
    if (list) return list.every((value) => value === list[0]) && list[0] >= 10_000 ? list[0] : undefined;
  }
  return undefined;
}

/** What a site's "prove you are a person" page says, in its title or its first lines. */
const CHECK_PAGE_WORDS = /access to this page has been denied|access denied|are you a human|verify (?:that )?you(?: are|'re|’re) (?:a )?human|not a robot|are you a robot|press (?:&|and) hold|unusual traffic|pardon our interruption|just a moment|attention required|request unsuccessful|checking your browser|security check/i;
/** What such a page is built with. Not the bot-detection scripts every page of a site loads: the pieces of the check itself. */
const CHECK_PAGE_MARKUP = /px-captcha|captcha-delivery\.com|cf-chl-|cf_chl_opt|cf-challenge-running|Incapsula incident|distil_r_captcha/i;

/**
 * Is this the site's check page and not the listing? It has no photos, says
 * nothing a listing says, is a few lines long, and says what such pages say.
 * (This used to look for the word "robot" anywhere in the page, which made a
 * block page of every listing with a robots tag and no photo we accept.)
 */
function isCheckPage(html: string, title: string | undefined, text: string, photos: string[], own: Headline): boolean {
  if (photos.length || own.price !== undefined || own.beds !== undefined || text.length > 4_000) return false;
  return CHECK_PAGE_WORDS.test(`${title ?? ""} ${text.slice(0, 2_000)}`) || CHECK_PAGE_MARKUP.test(html.slice(0, 200_000));
}

/** A listing page read, and its visible text for whoever wants to read more out of it. */
function readHtml(url: string, raw: string): { info: ListingInfo; text: string } {
  const html = raw.slice(0, MAX_HTML_CHARS);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const metas = metaIndex(html);
  // A title is a line and a summary a paragraph; anything longer is cut before it is searched.
  const title = (metas.get("og:title")?.[0] ?? titleOf(html))?.slice(0, 300);
  const summary = (metas.get("og:description")?.[0] ?? metas.get("description")?.[0] ?? "").slice(0, 2_000);
  // The link preview is a sentence: its beds, baths and size are taken only when it says them side by side and says no other size.
  const own = parseListingText(`${title ?? ""} | ${summary}`, true);
  const ld = jsonLd(html);
  const photos = extractPhotos(html, url, metas, ld);
  const text = pageText(html);
  const linkAddress = addressFromUrl(url);

  if (isCheckPage(html, title, text, photos, own)) {
    // A check page says nothing about the house: what is known comes from the link alone.
    return { info: { url, host, fetched: false, note: `${host} blocked automated access. Upload the listing photos instead.`, address: linkAddress, photos: [] }, text };
  }

  // Price: the page's structured data first, then the link preview, then the JSON the page
  // ships with (portals put the price in a data blob rather than in the description).
  const ldPrice = priceFromJsonLd(html, ld);
  const price = ldPrice ?? own.price ?? priceFromJson(html);
  // Address: the title on most portals is "123 Main St, City, ST 98103 | ...". The link says it too.
  const titleAddress = title ? findAddress(title) : undefined;

  // The house's rooms and size, most believable first: a link preview that gives all three side
  // by side (a portal writes its preview that way, and it is about this page by construction);
  // the page's own text, in its headline or on lines of their own, whichever it says first; its
  // data, unless that contradicts any of these (then it is the similar-homes widget's); and
  // last a preview that names only some of them. What the preview says in a sentence ("built in
  // 1987") is kept as loose.
  const page = readPage({ html, text, ld });
  // The page's <title> comes out as the first line of its text. It was read above, the way a link preview is; as
  // a line of the page it would stand over the address like a brokerage's name ("Windfall Realty"). Blanked in
  // place, so the lines keep their numbers.
  const pageTitle = titleOf(html);
  const firstEnd = text.indexOf("\n");
  const first = firstEnd === -1 ? text : text.slice(0, firstEnd);
  const z = subjectZone(tidy(pageTitle && first.replace(/\s+/g, " ").trim() === pageTitle ? `${"~".repeat(first.length)}${text.slice(first.length)}` : text));
  const seen = roomsOf(z, page);
  const cost = priceAt(z, seen.at);
  const rooms = { beds: own.beds, baths: own.baths, sqft: own.sqft };
  const whole = own.beds !== undefined && own.baths !== undefined && own.sqft !== undefined;
  const lead = mergeFacts(
    headlineFacts({ price, address: titleAddress ?? linkAddress }, { price: ldPrice === undefined && own.price !== undefined ? "meta" : "data", address: titleAddress ? "meta" : "link" }),
    whole ? headlineFacts(rooms, "meta") : undefined,
    seen.rooms,
    headlineFacts({ price: cost?.value, address: ownAddress(z, addressesIn(z, 8), seen.at, cost?.at) }, "text"),
  );
  const facts = mergeFacts(lead, withoutStatedRooms(contradicts(page.data, lead) ? withoutData(page.facts) : page.facts), whole ? undefined : headlineFacts(rooms, "meta"), readText(summary, "meta").facts);
  const info: ListingInfo = {
    url,
    host,
    fetched: true,
    title,
    // Where the link preview did not say, the page's own data may have: the line and the facts are one reading.
    ...headlineOf(facts),
    photos,
    // A link preview's summary is not the listing's description, and is kept as what it is.
    description: page.description ?? (summary.length >= 40 ? { text: summary, source: "meta" } : undefined),
    facts: someFacts(facts),
    details: page.details.length ? page.details : undefined,
  };
  return { info, text };
}

export function parseListingHtml(url: string, html: string): ListingInfo {
  return readHtml(url, html).info;
}

/**
 * Cities whose names are more than one word, by state, in lower case. Zillow
 * joins the street and the city of a link with the same hyphen
 * ("1500-S-336th-St-Federal-Way"), and nothing in the words themselves says
 * where one ends: "Way", "Place" and "Lake" end streets and cities alike, and
 * a street can be called "E St". So the city is the last word unless the
 * link ends in one of these names; guessing by the kinds of words got more
 * links wrong than it got right. Washington only, where flip opens first:
 * elsewhere the last word stands, as it always has.
 */
const CITIES_OF_SEVERAL_WORDS: Record<string, string[]> = {
  WA: [
    "airway heights", "anderson island", "bainbridge island", "battle ground", "beaux arts", "benton city", "big lake", "birch bay", "black diamond", "bonney lake", "browns point", "brush prairie",
    "camano island", "castle rock", "clallam bay", "cle elum", "clear lake", "clyde hill", "college place", "coulee dam", "dash point", "deer harbor", "deer park", "des moines", "east olympia",
    "east wenatchee", "electric city", "elk plain", "fall city", "federal way", "fort lewis", "fox island", "friday harbor", "gig harbor", "gold bar", "grand coulee", "grand mound", "granite falls",
    "hunts point", "joint base lewis mcchord", "kettle falls", "la center", "la conner", "lake forest park", "lake stevens", "lake tapps", "liberty lake", "long beach", "loon lake", "lopez island",
    "maple valley", "medical lake", "mercer island", "mill creek", "moses lake", "mount vernon", "mountlake terrace", "neah bay", "newman lake", "nine mile falls", "normandy park", "north bend",
    "oak harbor", "ocean park", "ocean shores", "otis orchards", "pe ell", "point roberts", "port angeles", "port hadlock", "port ludlow", "port orchard", "port townsend", "royal city",
    "sedro woolley", "snoqualmie pass", "soap lake", "south bend", "south cle elum", "south hill", "south prairie", "spokane valley", "union gap", "university place", "vashon island", "walla walla",
    "west richland", "white center", "white salmon", "white swan", "yarrow point",
  ],
};

/**
 * Where the street ends and the city begins in the words of a Zillow link:
 * before the last word, or before the name of a city of several words when
 * the link ends in one (the longest such name; a street's number and at
 * least one word of its name stay with the street).
 */
function splitStreetAndCity(words: string[], state: string): [string, string] {
  const known = CITIES_OF_SEVERAL_WORDS[state] ?? [];
  let cityWords = 1;
  for (const city of known) {
    const n = city.split(" ").length;
    if (n > cityWords && words.length - n >= 2 && words.slice(-n).join(" ").toLowerCase() === city) cityWords = n;
  }
  return [words.slice(0, -cityWords).join(" "), words.slice(-cityWords).join(" ")];
}

/**
 * Portals put the address in the URL path, so even a blocked page tells us
 * which house it is: Zillow "/homedetails/13013-224th-St-E-Graham-WA-98338/…",
 * Redfin "/WA/Graham/13013-224th-St-E-98338/home/…", Realtor
 * "/realestateandhomes-detail/13013-224th-St-E_Graham_WA_98338_…".
 */
export function addressFromUrl(url: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return undefined;
  }
  const title = (s: string) => s.replace(/-/g, " ").trim();
  // Zillow: /homedetails/<street>-<City>-<ST>-<zip>/<zpid>_zpid/
  // Street and city are joined by the same hyphen: see splitStreetAndCity.
  const z = path.match(/\/homedetails\/([^/]+)-([A-Z]{2})-(\d{5})\//);
  if (z) {
    const words = z[1].split("-").filter(Boolean);
    // A city is letters; a link whose last word before the state is not one has no address flip can read.
    if (words.length >= 2 && /^[A-Za-z.']+$/.test(words[words.length - 1])) {
      const [street, city] = splitStreetAndCity(words, z[2]);
      return `${street}, ${city}, ${z[2]} ${z[3]}`;
    }
  }
  // Redfin: /<ST>/<City>/<street>-<zip>/home/<id>
  const r = path.match(/^\/([A-Z]{2})\/([^/]+)\/(.+?)-(\d{5})\/home\//);
  if (r) return `${title(r[3])}, ${title(r[2])}, ${r[1]} ${r[4]}`;
  // Realtor: /realestateandhomes-detail/<street>_<City>_<ST>_<zip>_<id>
  const m = path.match(/\/realestateandhomes-detail\/([^_]+)_([^_]+)_([A-Z]{2})_(\d{5})/);
  if (m) return `${title(m[1])}, ${title(m[2])}, ${m[3]} ${m[4]}`;
  return undefined;
}

/** A listing page's visible text is a few thousand characters; the facts are near the top. */
const MAX_PAGE_TEXT_CHARS = 200_000;

/** Text made ready for reading: runs of spaces made one, line breaks kept. What is read here is read on one line at a time. */
const tidy = (text: string) => text.slice(0, MAX_PAGE_TEXT_CHARS).replace(/\r/g, "").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n");

/**
 * The part of a page's text its headline is read from: the house's own part
 * (lib/listing/zone.ts), with its paragraphs blanked out position for
 * position. A headline is a short line, and what a sentence of the remarks
 * mentions ("the 1 bedroom ADU with 1 bath") is not the house's headline.
 */
function subjectZone(t: string): string {
  if (!t.includes("\n")) return t;
  const lines = t.split("\n");
  if (lines.length < 5) return t;
  // Told on the lines that have something on them, the way the fact reader counts them.
  const full: number[] = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].trim()) full.push(i);
  const end = houseEnd(full.map((i) => lines[i]));
  return lines
    .slice(0, end < full.length ? full[end] : lines.length)
    .map((line) => (isParagraph(line) ? "~".repeat(line.length) : line))
    .join("\n");
}

const BED = String.raw`(?:bedrooms?|beds?|bds?|br)(?![a-z])`;
const BATH = String.raw`(?:full )?(?:bathrooms?|baths?|ba)(?![a-z])`;
const AREA = String.raw`(?:sq\.? ?ft\.?|sqft|square f(?:ee|oo)t|sf)(?![a-z])`;
const BEDS_N = String.raw`(\d{1,2})`;
const BATHS_N = String.raw`(\d{1,2}(?:\.\d{1,2})?)`;
/** Living area: three to five digits, so an 850 sqft house is 850 and not the next house's 2,950. */
const AREA_N = String.raw`(\d{1,2},\d{3}|\d{3,5})`;
/** What stands between two of the three: a space, a comma, a bar, a line break, "and". Never words. */
const BETWEEN = String.raw`[\s,·|∙•/&-]{0,5}(?:and )?`;
/** "…, 1 half bath" after the full baths. */
const HALF = String.raw`(?:${BETWEEN}(\d) ?(?:half|partial) ?(?:bathrooms?|baths?|ba)(?![a-z]))?`;
/** The lot between the baths and the size: "… · 0.17 acres · …", "… · 7,405 sqft lot · …". */
const ACRES = String.raw`(?:${BETWEEN}(?:\d{1,3}(?:\.\d{1,3})? ?(?:acres?|ac)(?: lot)?|\d{1,3}(?:,\d{3})? ?(?:sq\.? ?ft\.?|sqft|sf) lot)(?![a-z]))?`;
/** Not the tail of a longer number, and not money. */
const NEW_NUMBER = String.raw`(?:^|[^\d.,$])`;
const NOT_A_LOT = String.raw`(?!\.? ?lot\b)`;
/** A size said after a few words ("…home with 2,340 sq ft") is the house's only when nothing after it says it is something else's ("a 1,200 sqft detached shop"). */
const OF_THE_HOME = String.raw`(?=$|[.,;!)\n]| of living| home| house| single| residence| condo| townho| property| located| built| in | on )`;

interface Shape {
  pattern: RegExp;
  beds?: number;
  baths?: number;
  half?: number;
  sqft?: number;
}

/**
 * Beds, baths and living area the way a listing leads with them: side by
 * side, each number with its own unit on its own line.
 *   "4 bd 3 ba 2,340 sqft"                 numbers first (also over several lines, "4 BR | 3 BA | 2,340 SF",
 *                                          "4 beds, 2 full baths, 1 half bath, 2,340 sqft")
 *   "4 bedroom, 3 bathroom home with 2,340 sq ft"   the size after a few words, when nothing says it is something else's
 *   "2,340 sqft · 4 bd · 3 ba"             the size first
 *   "4 bd | 2,340 sqft | 3 ba"             the size in the middle
 *   "4 beds · 2,340 sqft"                  no baths said
 *   "1 ba 480 sqft"                        no bedrooms said
 *   "Beds: 4  Baths: 3  Sq Ft: 2,340"      labels first
 * Words between the beds and the baths ("a 4 bedroom rambler with a detached
 * 1 bath ADU") are a sentence, and a sentence is not read.
 */
const SIDE_BY_SIDE: Shape[] = [
  { pattern: new RegExp(`${NEW_NUMBER}${BEDS_N} ?${BED}${BETWEEN}${BATHS_N} ?${BATH}${HALF}${ACRES}(?:${BETWEEN}${AREA_N} ?${AREA}${NOT_A_LOT})?`, "i"), beds: 1, baths: 2, half: 3, sqft: 4 },
  { pattern: new RegExp(`${NEW_NUMBER}${BEDS_N} ?${BED}${BETWEEN}${BATHS_N} ?${BATH}${HALF} [^\\d\\n]{1,44}? ${AREA_N} ?${AREA}${NOT_A_LOT}${OF_THE_HOME}`, "i"), beds: 1, baths: 2, half: 3, sqft: 4 },
  { pattern: new RegExp(`${NEW_NUMBER}${AREA_N} ?${AREA}${NOT_A_LOT}${BETWEEN}${BEDS_N} ?${BED}${BETWEEN}${BATHS_N} ?${BATH}${HALF}`, "i"), sqft: 1, beds: 2, baths: 3, half: 4 },
  { pattern: new RegExp(`${NEW_NUMBER}${BEDS_N} ?${BED}${BETWEEN}${AREA_N} ?${AREA}${NOT_A_LOT}${BETWEEN}${BATHS_N} ?${BATH}${HALF}`, "i"), beds: 1, sqft: 2, baths: 3, half: 4 },
  { pattern: new RegExp(`${NEW_NUMBER}${BEDS_N} ?${BED}${BETWEEN}${AREA_N} ?${AREA}${NOT_A_LOT}`, "i"), beds: 1, sqft: 2 },
  { pattern: new RegExp(`${NEW_NUMBER}${BATHS_N} ?${BATH}${HALF}${BETWEEN}${AREA_N} ?${AREA}${NOT_A_LOT}`, "i"), baths: 1, half: 2, sqft: 3 },
  {
    pattern: new RegExp(
      // "Beds: 3+" is a search filter's, and "Baths 2/1" is two full and one half.
      `\\b(?:bedrooms?|beds?):? ?${BEDS_N}(?!\\d|[.,]\\d|\\+)${BETWEEN}(?:bathrooms?|baths?):? ?${BATHS_N}(?:\\/(\\d)(?!\\d))?(?!\\d|,\\d|\\+)(?:${BETWEEN}(?:sq\\.? ?ft\\.?|sqft|square feet|square footage|living area|living space):? ?${AREA_N}(?!\\d|[.,]\\d))?`,
      "i",
    ),
    beds: 1,
    baths: 2,
    half: 3,
    sqft: 4,
  },
];

const number = (raw: string | undefined) => {
  const n = raw === undefined ? NaN : Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

interface Summary {
  beds?: number;
  baths?: number;
  sqft?: number;
  /** Where in the text the three were read. */
  at?: [number, number];
}

/**
 * The first place the text says the house's rooms and size side by side.
 * `alone`: for a link preview, which is a sentence. There the bedrooms have
 * to be named, and its numbers are taken only when it says no other size
 * than theirs: "the 2 bedroom, 1 bath cottage at the back is 720 sqft" is
 * not the house.
 */
function summaryNumbers(z: string, alone = false): Summary {
  let first: { m: RegExpExecArray; shape: Shape } | undefined;
  for (const shape of SIDE_BY_SIDE) {
    if (alone && !shape.beds) continue;
    const m = shape.pattern.exec(z);
    // The earliest wins; of two that start together, the one that reads more.
    if (m && (!first || m.index < first.m.index || (m.index === first.m.index && m[0].length > first.m[0].length))) first = { m, shape };
  }
  if (!first) return {};
  const { m, shape } = first;
  const at: [number, number] = [m.index + Math.max(0, m[0].search(/[A-Za-z0-9]/)), m.index + m[0].length];
  if (alone) {
    const rest = `${z.slice(0, at[0])} ${z.slice(at[1])}`;
    if (new RegExp(`${NEW_NUMBER}${AREA_N} ?${AREA}${NOT_A_LOT}`, "i").test(rest)) return {};
  }
  const full = shape.baths ? number(m[shape.baths]) : undefined;
  const half = shape.half ? number(m[shape.half]) : undefined;
  return {
    beds: shape.beds ? number(m[shape.beds]) : undefined,
    baths: full === undefined ? undefined : full + (half ?? 0) / 2,
    sqft: shape.sqft ? number(m[shape.sqft]) : undefined,
    at,
  };
}

const PRICE = /\$ ?(\d{1,3}(?:,\d{3}){1,2}|\d{5,8})(?!\d|,\d{3})/g;
/** A period after it: "$3,800/mo", "$235 per sqft". */
const PER_SOMETHING = /^ ?(?:\/|per |a |each ) ?(?:mo|month|sq|sf|yr|year|week)/i;
/**
 * The few labels that say an amount is some other money, when they stand
 * right before it on its own line: an estimate, a value somebody put on the
 * house, a past sale, the size of a price cut, the price it used to be, the
 * top of a range. Not words a page puts beside the asking price itself
 * ("Save", "More", "Price drop", "Estimated payment"): those once made the
 * reader skip the asking price and take a neighbour's.
 */
const OTHER_MONEY = String.raw`(?:rent )?zestimate®?|(?:redfin |home |automated )?estimate|est(?:\.|imated)? (?:value|price|sale price)|(?:home|market|appraised|tax) value|(?:tax[- ])?assessed(?: value)?(?: at)?|(?:tax )?assessment|appraised (?:at|for)|sold(?: for| on [\d/]{4,10}(?: for)?| price)?|last sold(?: for| price)?|price (?:cut|drop|reduction|reduced)(?::| by| of)|reduced by|was|originally|original(?: list(?:ing)?)? price|previous(?: list(?:ing)?)? price|up to|down payment|closing costs?|suggested offer|(?:get )?(?:an? )?(?:instant )?cash offer|instant offer|loan amount`;
const NOT_THE_PRICE_BEFORE = new RegExp(String.raw`\b(?:${OTHER_MONEY})[: ]{0,3}$`, "i");
/**
 * Of those, the ones that say nothing of what the house is worth: a lender's
 * offer, the size of a price cut, the price it used to be. A page with one of
 * these where its price would stand still has an asking price somewhere; a
 * page with "Sold for" or an estimate there has none.
 */
const ASIDE = /\b(?:up to|down payment|closing costs?|loan amount|(?:get )?(?:an? )?(?:instant )?cash offer|instant offer|price (?:cut|drop|reduction|reduced)(?::| by| of)|reduced by|was|originally|original(?: list(?:ing)?)? price|previous(?: list(?:ing)?)? price|suggested offer)[: ]{0,3}$/i;
/** The same labels by themselves on the line above an amount that has its line to itself: "Home value" / "$561,200". */
const NOT_THE_PRICE_ABOVE = new RegExp(String.raw`^(?:${OTHER_MONEY})[: ]{0,3}$`, "i");
/** The one label that follows its amount: "$561,200 Zestimate". With a colon after it ("Zestimate: $561,200") it is the next amount's. */
const NOT_THE_PRICE_AFTER = /^ ?(?:rent )?zestimate(?!®? ?:)®?|^ ?redfin estimate(?! ?:)/i;
/** What may stand between a price and the old price shown after it: nothing, or the price's monthly payment ("$549,000 Est. $3,459/mo $575,000"). */
const PAYMENT_BETWEEN = /^[\s·|•–-]*(?:est\.? ?(?:payment:? ?)?\$ ?[\d,]+ ?\/ ?mo(?:nth)?\.?)?[\s·|•–-]*$/i;
/** The same for the plain word, as a label and not the start of a button: "$561,200 Estimate" and "$561,200 Estimated value", not "$549,000 Estimate your payment" or "$549,000 Est. $3,456/mo". Case matters here. */
const AN_ESTIMATE_AFTER = /^ ?(?:Estimated [Vv]alue|ESTIMATED VALUE|Estimate|ESTIMATE)(?![A-Za-z])(?! ?[a-z$:])/;
/** A range is not an asking price, neither end of it: "$520,000 - $575,000". The second amount is captured: a much smaller one is a price cut ("$549,000 - $20,000"), and the first is then the price. */
const BEFORE_A_RANGE = /^ ?(?:-|–|—|to) ?\$ ?(\d{1,3}(?:,\d{3}){1,2}|\d{5,8})(?!\d|,\d{3})(?! ?(?:\/|per ))/;
/** An amount right after another and a dash: the other end of a range, or the size of a cut. Never the asking price. */
const AFTER_A_DASH = /\$ ?[\d,]{5,11} ?(?:-|–|—|to) ?$/;
/** What a page writes before its asking price, and nothing else on the line. */
const PRICE_LABEL = /^(?:(?:(?:list(?:ing)?|asking|sale|sales|current|offer(?:ed|ing)?) )?price|listed (?:for|at)|offered (?:for|at)|priced at|for sale|asking|now)[: ]{0,3}$/i;
/** What may follow the asking price on its line: nothing, cents, the headline ("· 4 bd"), a payment estimate. */
const AFTER_A_PRICE = /^(?:\.\d\d)? ?(?:$|[·|•(–-]|\d|est\b)/i;

interface Amount {
  at: number;
  /** Where its digits end, and which of the lines that have something on them it stands on. */
  end: number;
  line: number;
  value: number;
  /** Nothing says it is other money. */
  ok: boolean;
  /** It stands by itself, or behind a label that says "price": the way a page gives its asking price. On a line of its own; or, in a text with no lines, with no small word right after it ("get $12,500 back", "$40,000 in upgrades"). */
  alone: boolean;
  /** It is other money of the kind that says nothing of what the house is worth. */
  aside: boolean;
  /** "Price:" stands right before it. */
  labelled: boolean;
}

/**
 * The asking price among these amounts. One standing by itself on its line
 * is believed before one inside a phrase ("Price reduced $20,000", "Buy with
 * us and get $12,500 back"). Where no line tells (one unbroken run of text),
 * a small amount beside a much larger one is the credit or the cut, and the
 * larger one the price.
 */
function askingPrice(pool: Amount[], nearestFirst: boolean): Amount | undefined {
  const usable = pool.filter((a) => a.ok);
  if (!usable.length) return undefined;
  const inOrder = nearestFirst ? [...usable].reverse() : usable;
  return inOrder.find((a) => a.alone) ?? orLarger(inOrder[0], usable);
}

/** A small amount beside a much larger one is the credit or the cut, and the larger one the price. */
function orLarger(chosen: Amount, pool: Amount[]): Amount {
  const larger = pool.filter((a) => a.ok && Math.abs(a.at - chosen.at) <= 200 && a.value > chosen.value * 2.5);
  return larger.length ? larger.reduce((x, y) => (Math.abs(y.at - chosen.at) < Math.abs(x.at - chosen.at) ? y : x)) : chosen;
}

/**
 * The asking price and where it stands: an amount of ten thousand dollars or
 * more that nothing on its own line, or by itself on the line above it, says
 * is some other money. An amount standing by itself is believed before one
 * inside a phrase, wherever the two stand. It is looked for where a listing
 * puts it:
 *
 *   1. by itself, just above the line with the beds and baths;
 *   2. by itself, at the top of the page (when that line is far down, in a
 *      table of facts);
 *   3. by itself, in the dozen lines under that line: a status, an open
 *      house, the remarks of a two-column page may stand between;
 *   4. inside a phrase just above that line, then at the top of the page;
 *   5. on that line itself, after the rooms;
 *   6. behind the word "Price", anywhere.
 *
 * From 3 on, not when the page says where its price would stand what the
 * house sold for or what somebody thinks it is worth: that page has no
 * asking price, and a price further down is another home's.
 */
function priceAt(z: string, beside?: [number, number]): Amount | undefined {
  const amounts: Amount[] = [];
  const lined = z.includes("\n");
  let seen = 0;
  /** The line being read, the last line above it that had something on it, and where the words of the amount before end when a label after it was its own. */
  let lineStart = 0;
  let lineEnd = z.indexOf("\n");
  let lineNo = 0;
  let above = "";
  let spoken = 0;
  /** The last amount that nothing said was other money. */
  let price: Amount | undefined;
  const small = (word: string) => /^[a-z]/.test(word) && !/^est\b/.test(word);
  /** The next line under the one that ends at `from` that has something on it (a long one counts as nothing to read), and where it ends. */
  const lineUnder = (from: number): { text: string; end: number } | undefined => {
    for (let hop = 0, start = from + 1; hop < 4 && from !== -1 && start <= z.length; hop++) {
      const stop = z.indexOf("\n", start);
      const end = stop === -1 ? z.length : stop;
      const text = z.slice(start, Math.min(end, start + 61)).trim();
      if (text) return { text: end - start <= 60 ? text : "", end: stop };
      if (stop === -1) return undefined;
      start = stop + 1;
    }
    return undefined;
  };
  for (const m of z.matchAll(PRICE)) {
    if (++seen > 2_000 || amounts.length >= 80) break;
    const at = m.index ?? 0;
    const end = at + m[0].length;
    while (lineEnd !== -1 && lineEnd < at) {
      const passed = z.slice(lineStart, Math.min(lineEnd, lineStart + 60)).trim();
      if (passed) {
        above = lineEnd - lineStart <= 60 ? passed : "";
        lineNo++;
      }
      lineStart = lineEnd + 1;
      lineEnd = z.indexOf("\n", lineStart);
    }
    const rest = z.slice(end, Math.min(lineEnd === -1 ? z.length : lineEnd, end + 60));
    const value = number(m[1]);
    if (PER_SOMETHING.test(rest) || value === undefined || value < 10_000) continue;
    const own = rest.match(NOT_THE_PRICE_AFTER) ?? rest.match(AN_ESTIMATE_AFTER);
    const before = z.slice(Math.max(lineStart, spoken, at - 40), at);
    const lead = z.slice(Math.max(lineStart, at - 40), at).trim();
    const startsLine = lead === "" && at - lineStart <= 2;
    const last = amounts[amounts.length - 1];
    // "$520,000 - $575,000" is a range, and neither end is the price. "$549,000 - $20,000" is the price and its cut.
    const other = number(rest.match(BEFORE_A_RANGE)?.[1]);
    const rangeStart = other !== undefined && other >= value * 0.5 && other <= value * 2;
    const afterDash = AFTER_A_DASH.test(before) && last !== undefined;
    // A value card writes its number over its label: "$561,200" / "Estimate". The label is this amount's unless
    // another amount stands right under it ("Home value" / "$561,200"): then it is that one's.
    const under = startsLine && rest.trim() === "" ? lineUnder(lineEnd) : undefined;
    const below = under && NOT_THE_PRICE_ABOVE.test(under.text) && !/^\$ ?[\d,]+$/.test(lineUnder(under.end)?.text ?? "") ? under.text : "";
    const lastWords = lead.split(" ");
    const labelled = PRICE_LABEL.test(lastWords.slice(-1).join(" ")) || PRICE_LABEL.test(lastWords.slice(-2).join(" "));
    const alone = lined
      ? at - lineStart <= 40 && (lead === "" || PRICE_LABEL.test(lead)) && AFTER_A_PRICE.test(rest)
      : labelled || !small(rest.trimStart().split(" ", 1)[0] ?? "");
    // A listing that came down shows the price it had right after the price it has: "$549,000" / "$575,000",
    // on the same line or the next. Whatever stands there, larger by a little than the price before it, is an
    // old price, however many times the page says it.
    let old = false;
    if (price && last && value > price.value && value <= price.value * 1.3) {
      // On the price's own line: right after it, after the amount that was right after it, or after its monthly payment.
      const beside = price.line === lineNo && ((last.line === lineNo && at - last.end <= 3) || (at - price.end <= 40 && PAYMENT_BETWEEN.test(z.slice(price.end, at))));
      old = beside || (lined && alone && price.alone && price.line === lineNo - 1);
      // With the old price beside it on its line, the price still has that line to itself.
      if (beside && lined && !price.alone && price.at - lineStart <= 40) {
        const leads = z.slice(lineStart, price.at).trim();
        price.alone = leads === "" || PRICE_LABEL.test(leads);
      }
    }
    const ok = !own && !rangeStart && !afterDash && !old && !below && !NOT_THE_PRICE_BEFORE.test(before) && !(startsLine && NOT_THE_PRICE_ABOVE.test(above));
    const aside = !ok && (old || ASIDE.test(before) || (startsLine && ASIDE.test(above)) || ASIDE.test(below) || (afterDash && (last.ok || last.aside)));
    if (own) spoken = end + own[0].length;
    const amount: Amount = { at, end, line: lineNo, value, ok, alone, aside, labelled };
    amounts.push(amount);
    if (ok) price = amount;
  }
  if (!amounts.length) return undefined;
  const labelled = () => amounts.find((a) => a.ok && a.labelled);
  if (!beside) return askingPrice(amounts.filter((a) => a.at <= amounts[0].at + 600), false) ?? labelled();

  // The dozen lines with something on them under the line of beds and baths; in a text with no lines, the next few hundred characters.
  let limit = beside[1];
  if (lined) {
    for (let lines = 0; lines <= 12 && limit < z.length; ) {
      const next = z.indexOf("\n", limit + 1);
      const stop = next < 0 ? z.length : next;
      if (z.slice(limit + 1, Math.min(stop, limit + 80)).trim() || lines === 0) lines++;
      limit = stop;
    }
    limit = Math.min(limit, beside[1] + 6_000);
  } else {
    limit = Math.min(z.length, beside[1] + 600);
  }
  const under = amounts.filter((a) => a.at >= beside[0] && a.at <= limit);
  const over = amounts.filter((a) => a.at < beside[0]);
  const near = over.filter((a) => a.at >= beside[0] - 400);

  const just = [...near].reverse().find((a) => a.ok && a.alone);
  if (just) return just;
  if (over.length && over[0].ok && over[0].alone) return over[0];
  // Where its price would stand, the page says what the house sold for or what somebody thinks it is worth.
  const valued = over.some((a) => !a.ok && !a.aside);
  const first = valued ? undefined : under.find((a) => a.ok && a.alone);
  // In a text with no lines, "Price reduced $20,000 $549,000" has the cut first: a much larger amount beside it is the price.
  const box = first && !lined ? orLarger(first, under) : first;
  const phrase = askingPrice(near, true) ?? (over.length && over[0].ok ? over[0] : undefined);
  // On lines, an amount with its line to itself under the rooms is believed before one inside a
  // phrase above them. In a text with no lines nothing has a line to itself, and what stands
  // above the rooms comes first, unless what stands under them is plainly the larger matter
  // ("$40,000 in upgrades" above, the price under).
  if (box && (lined || !phrase || box.value > phrase.value * 2.5)) return box;
  if (phrase || valued) return phrase;
  const lineEndsAt = z.indexOf("\n", beside[1]);
  const sameLine = lined ? (lineEndsAt < 0 ? z.length : lineEndsAt) : beside[1] + 60;
  return under.find((a) => a.ok && a.at <= sameLine && (lined || a.alone)) ?? labelled();
}

const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI".split(" "));
/** What a number is counted in, and the small words between numbers. A number followed by one of these is a measurement or a count ("2 bd", "1 of 37", "3 hrs ago") when the address's own number comes after it. */
const NOT_AFTER_A_HOUSE_NUMBER = new Set(
  "bd bds bed beds bedroom bedrooms br ba bath baths bathroom bathrooms full half sq ft sqft sf square feet foot acre acres lot of in on at by for and with from is to ago hr hrs hour hours min mins minute minutes day days week weeks month months year years yr mo est photo photos more".split(" "),
);
/** What a number after it belongs to: a unit, a lot, a route. Not a house. */
const NUMBERED_THING = new Set("unit apt apartment suite ste lot space spc bldg building trlr trailer box route rte rt highway hwy us sr cr fm rr road rd interstate".split(" "));
const COMPASS_WORD = /^(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?$/i;
/** Streets named with a number in front: "12 Mile Rd", "3 Notch Rd", "4 Seasons Dr". After a house number, the number before one of these is the street's. */
const NUMBERED_STREET =
  /^(?:mile|notch|seasons|bridges|forks|oaks|hills|lakes|pines|points|corners|springs|chimneys|rivers|sisters|brothers|rod|chopt|bells|flags|gables|penny|palms|gates|winds|elms|maples|cedars|willows|ponds|creeks|peaks|fields|meadows|farms|towers|waters|trees|pillars|arches)$/i;

/**
 * The address that ends at ", ST 12345", read backwards from there. `head`
 * is what stands before that comma on its line.
 *
 * Before the state comes the city, and before the city a run of words and
 * numbers. The house number is the first number of that run that starts an
 * address: in "1234 E 4500 S" it is 1234 and in "45200 12 Mile Rd" it is
 * 45200. A number followed by what it is counted in is not one when the
 * address's own number comes after it, which is how "2 bd 1 ba 850 sqft 123
 * Main St" gives 123 while "712 Day Lily Ln" stays 712. And where two
 * numbers stand side by side after other text on the line ("Built in 1987
 * 123 Main St", "1 of 37 123 Main St"), the first is not the house's, unless
 * the street is one of those named with a number.
 */
function addressBefore(head: string, state: string, zip: string, startsLine: boolean, needsCity = false): { address: string; lead: string } | undefined {
  let from = head.length;
  while (from > 0 && head.length - from < 110 && /[A-Za-z0-9 .,'#/-]/.test(head[from - 1])) from--;
  const before = head.slice(from).trim();
  // After a comma, the last part is the city ("…St E, Graham"). With none, the city is the street's last words.
  const cityAt = before.lastIndexOf(",");
  const lastPart = cityAt < 0 ? "" : before.slice(cityAt + 1).trim();
  const city = /^[A-Za-z][A-Za-z .'-]{1,39}$/.test(lastPart) ? lastPart : "";
  const words = (city ? before.slice(0, cityAt) : before).split(" ").filter(Boolean);
  const bare = words.map((word) => word.replace(/,$/, ""));
  const lower = (i: number) => (bare[i] ?? "").toLowerCase();

  // The run of words and numbers, backwards from the city.
  let first = bare.length;
  while (first > 0) {
    const word = bare[first - 1];
    if (!HOUSE_NUMBER.test(word) && !STREET_WORD.test(word)) break;
    // A five-digit number after a state is the zip of the address before this one.
    if (/^\d{5}$/.test(word) && STATES.has(bare[first - 2] ?? "")) break;
    first--;
  }
  /** A number that can start an address: something follows it, and it is not a unit's, a lot's or a route's. */
  const canStart = (i: number) => {
    if (!HOUSE_NUMBER.test(bare[i] ?? "") || i + 1 >= bare.length) return false;
    const before = lower(i - 1).replace(/[.#]/g, "");
    // "7,405 sqft lot 13013 224th St E": after a measurement, "lot" ends it and numbers nothing.
    if (before === "lot" && /^(?:sqft|sf|ft|feet|acres?|ac)$/.test(lower(i - 2).replace(/\./g, ""))) return true;
    return !NUMBERED_THING.has(before);
  };
  /** A measurement or a count: a number, then what it is counted in, with the address's own number still to come. */
  const counted = (i: number) => {
    if (!NOT_AFTER_A_HOUSE_NUMBER.has(lower(i + 1).replace(/\.$/, ""))) return false;
    for (let j = i + 2; j < bare.length; j++) if (canStart(j)) return true;
    return false;
  };
  let start = first;
  while (start < bare.length && !(canStart(start) && !counted(start))) start++;
  // Other text before it on its line: a number may have strayed in front of the house's.
  const alone = start === 0 && from === 0 && startsLine;
  while (!alone && start + 2 < bare.length && HOUSE_NUMBER.test(bare[start + 1]) && !NUMBERED_STREET.test(bare[start + 2])) start++;
  // A street has a second number of its own only right after its first ("45200 12 Mile Rd") or after one compass word
  // ("1234 E 4500 S"). With a name between two numbers ("850 Windfall Realty 100 Main St") the first is a stray.
  for (let next = start + 1; !alone && next < bare.length - 1; next++) {
    if (!canStart(next) || counted(next)) continue;
    const between = bare.slice(start + 1, next);
    if (between.length > 1 || (between.length === 1 && !COMPASS_WORD.test(between[0]))) start = next;
  }
  if (start >= bare.length - 1 || !bare.slice(start + 1).some((word) => /[A-Za-z]/.test(word))) return undefined;

  const street = words.slice(start).join(" ").replace(/,$/, "");
  if (street.length > 90 || (needsCity && !city)) return undefined;
  return { address: `${street}${city ? `, ${city}` : ""}, ${state} ${zip}`, lead: `${head.slice(0, from)} ${words.slice(0, start).join(" ")}`.trim() };
}

/** ", WA 98338", or " WA 98338" where the address is written the post office's way, without that comma. */
const ADDRESS_TAIL = /(, ?| )([A-Z]{2}) (\d{5})(?:-\d{4})?(?!\d)/g;

const CITY_ALONE = /^[A-Za-z][A-Za-z .'-]{1,39}$/;

/** The last line above the one that starts at `lineStart` that has something on it, blank lines stepped over. A long line is a paragraph, and no part of an address. */
function lineBefore(z: string, lineStart: number): { text: string; start: number } | undefined {
  let end = lineStart - 1;
  for (let hop = 0; hop < 4 && end > 0; hop++) {
    const start = z.lastIndexOf("\n", end - 1) + 1;
    if (end - start > 120) return undefined;
    const text = z.slice(start, end).trim();
    if (text) return { text, start };
    end = start - 1;
  }
  return undefined;
}

/** The street on the line above the one that starts at `lineStart`, and where it starts. A unit may have the line between them to itself: "123 Main St" / "Unit 4" / "Seattle, WA 98101". */
function streetAbove(z: string, lineStart: number): { street: string; start: number } | undefined {
  const above = lineBefore(z, lineStart);
  if (!above) return undefined;
  if (UNIT_LINE.test(above.text)) {
    const over = lineBefore(z, above.start);
    const street = over && streetLine(over.text);
    return over && street ? { street: `${street} ${above.text}`, start: over.start } : undefined;
  }
  const street = streetLine(above.text);
  return street ? { street, start: above.start } : undefined;
}

const ATTRIBUTION_WORDS = String.raw`\b(?:listed|brokered|presented|offered|marketed|provided) by\b|\bcourtesy of\b|\blisting (?:agent|office|broker|brokerage|provided|courtesy)\b`;
const BROKERAGE_WORDS = String.raw`\b(?:realty|realtors?|real estate|properties|brokerage|brokers?|associates|sotheby'?s|keller williams|coldwell banker|re\/max|remax|century 21|berkshire hathaway|windermere|llc|inc)\b`;
/** On the line above an address: whose it is. */
const ATTRIBUTION = new RegExp(ATTRIBUTION_WORDS, "i");
const BROKERAGE = new RegExp(BROKERAGE_WORDS, "i");
/** Before an address on its own line, with nothing but a name between them: "Listed by Windfall Realty, 100 Main St". An amount or a number between them and the words belong to something else. */
const ATTRIBUTED = new RegExp(String.raw`(?:${ATTRIBUTION_WORDS})[^\d$]{0,60}$`, "i");
const BROKERED = new RegExp(String.raw`(?:${BROKERAGE_WORDS})[^\d$]{0,20}$`, "i");

/** An address the text gives, where it starts and where its city stands, and what stands over it: 0 nothing in particular, 1 a brokerage's name, 2 the page's own words for an office ("Listed by …"). */
interface Said {
  address: string;
  from: number;
  at: number;
  office: 0 | 1 | 2;
}

/** The street addresses in the house's part of a text (already made ready by `subjectZone`), in the order it gives them. */
function addressesIn(z: string, most: number): Said[] {
  const found: Said[] = [];
  let tried = 0;
  let lineStart = 0;
  let lineEnd = z.indexOf("\n");
  for (const m of z.matchAll(ADDRESS_TAIL)) {
    if (++tried > 60 || found.length >= most) break;
    if (!STATES.has(m[2])) continue;
    const tail = m.index ?? 0;
    const comma = m[1] !== " ";
    while (lineEnd !== -1 && lineEnd < tail) {
      lineStart = lineEnd + 1;
      lineEnd = z.indexOf("\n", lineStart);
    }
    const city = comma && tail - lineStart <= 60 ? z.slice(lineStart, tail).trim() : "";
    let address: string | undefined;
    let lead = "";
    let firstLine = lineStart;
    if (lineStart > 0 && CITY_ALONE.test(city)) {
      // A city by itself on its line: the street is the line above it ("13013 224th St E" / "Graham, WA 98338"), when that line is a street.
      const above = streetAbove(z, lineStart);
      if (above) {
        address = `${above.street}, ${city}, ${m[2]} ${m[3]}`;
        firstLine = above.start;
      }
    } else {
      const from = Math.max(lineStart, tail - 200);
      // Without the comma before the state, only what is plainly a street and its city: "13013 224th St E, Graham WA 98338".
      const read = addressBefore(z.slice(from, tail), m[2], m[3], from === lineStart, !comma);
      address = read?.address;
      lead = read?.lead ?? "";
    }
    if (!address || found.some((a) => a.address === address)) continue;
    const above = lineBefore(z, firstLine)?.text ?? "";
    // Where it starts: its first line, or in a text with no lines about where its street begins.
    const from = z.includes("\n") ? firstLine : Math.max(0, tail - (address.length - 10));
    found.push({ address, from, at: tail, office: ATTRIBUTED.test(lead) || ATTRIBUTION.test(above) ? 2 : BROKERED.test(lead) || BROKERAGE.test(above) ? 1 : 0 });
  }
  return found;
}

/** The lines of a text that have something on them: which of them a place in the text stands on, and what one says. */
function contentLines(z: string): { at: (offset: number) => number; text: (line: number) => string } {
  const starts: number[] = [];
  for (let start = 0; start <= z.length; ) {
    const end = z.indexOf("\n", start);
    const stop = end === -1 ? z.length : end;
    if (stop > start && z.slice(start, Math.min(stop, start + 80)).trim()) starts.push(start);
    if (end === -1) break;
    start = end + 1;
  }
  return {
    at: (offset) => {
      let low = 0;
      let high = starts.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (starts[mid] <= offset) low = mid + 1;
        else high = mid;
      }
      return low - 1;
    },
    text: (line) => {
      const start = starts[line];
      if (start === undefined) return "";
      const end = z.indexOf("\n", start);
      return z.slice(start, Math.min(end === -1 ? z.length : end, start + 80)).trim();
    },
  };
}

/** A line that only measures the house or its lot: "Approx. 2,340 sq. ft.", "7,405 sqft lot", "0.17 acres". Such a line between the rooms and the address under them belongs to the rooms. */
const MEASURE_LINE = /^(?:(?:approx(?:\.|imately)?|about|~|lot(?: size)?:?) ?)?[\d,.]+ ?(?:sq\.? ?ft\.?|sqft|sf|square f(?:ee|oo)t|acres?|ac)\.?(?: lot| living area| of living space)?$/i;

/**
 * The house's own address among those the text gives. A listing leads with
 * its price, its address and its rooms together, so where an address stands
 * says whose it is before any word does: beside the price or the rooms (over
 * them, between them, right under them); else above them, near and then far;
 * else under them. What stands over an address only settles between two that
 * stand alike, and keeps out the ones that stand where an office's does: an
 * address under a brokerage's name is the house's only beside its price and
 * rooms or a little above them, and one under "Listed by" only above them.
 * A site's own name, a breadcrumb or "Listed by" over the house's own
 * address is ordinary, and so is an office's address under the same words
 * in the price box or at the foot of the page.
 */
function ownAddress(z: string, said: Said[], rooms?: [number, number], price?: number): string | undefined {
  if (!said.length) return undefined;
  const lines = z.includes("\n") ? contentLines(z) : undefined;
  // Counted in lines that have something on them; in a text with no lines, in stretches of forty characters.
  const unit = !rooms && price === undefined ? undefined : lines ? lines.at : (at: number) => at / 40;
  let best: { address: string; key: number[] } | undefined;
  for (const [order, a] of said.entries()) {
    let where = 0;
    let toRooms = 0;
    let leads = false;
    if (unit) {
      const start = unit(a.from);
      const end = unit(a.at);
      const from = Math.min(rooms ? unit(rooms[0]) : Infinity, price === undefined ? Infinity : unit(price));
      const to = Math.max(rooms ? unit(rooms[1]) : -Infinity, price === undefined ? -Infinity : unit(price));
      leads = end < from && from - end <= 15;
      // Right under them: on the next line, or with only a line or two that measure the house between ("7,405 sqft lot").
      let rightUnder = start > to && start - to <= (lines ? 1 : 1.5);
      if (lines && !rightUnder && start > to && start - to <= 3) {
        rightUnder = true;
        for (let line = to + 1; line < start; line++) if (!MEASURE_LINE.test(lines.text(line))) rightUnder = false;
      }
      where = (end >= from - 2 && start <= to) || rightUnder ? 0 : end < from ? (from - end <= 15 ? 1 : 2) : start - to <= 8 ? 3 : 4;
      toRooms = rooms ? (end < unit(rooms[0]) ? unit(rooms[0]) - end : start > unit(rooms[1]) ? start - unit(rooms[1]) : 0) : 0;
    }
    const usable = a.office === 0 || (unit ? (a.office === 1 ? where <= 1 : leads) : a.office === 1);
    if (!usable) continue;
    // Beside the price and rooms or a little above them is one place: there what stands over the address decides first.
    const key = [where <= 1 ? 0 : where, a.office, where, toRooms, order];
    if (!best || key.some((value, i) => value !== best!.key[i] && key.slice(0, i).every((v, j) => v === best!.key[j]) && value < best!.key[i])) best = { address: a.address, key };
  }
  return best?.address;
}

/**
 * The street addresses a text gives for its own house, in order. A line that
 * holds a whole address is read by itself: on a line of its own, "123 Main
 * St, Tacoma, WA 98402" cannot pick up the "1 of 37" above it.
 */
export function findAddresses(text: string, most = 5): string[] {
  return addressesIn(subjectZone(tidy(text)), most).map((a) => a.address);
}

/** The first street address in a text. */
export function findAddress(text: string): string | undefined {
  return findAddresses(text, 1)[0];
}

const ROOMS = ["beds", "baths", "sqft"] as const;
type Stated = { facts: ListingFacts; where?: Partial<Record<string, number>> };

/** Where the nth line that has something on it starts and ends in the text. */
function lineSpan(z: string, first: number, last: number): [number, number] {
  let start = 0;
  let seen = -1;
  let from = 0;
  let to = z.length;
  while (start <= z.length) {
    const end = z.indexOf("\n", start);
    const stop = end === -1 ? z.length : end;
    if (z.slice(start, stop).trim()) {
      seen++;
      if (seen === first) from = start;
      if (seen === last) {
        to = stop;
        break;
      }
    }
    if (end === -1) break;
    start = end + 1;
  }
  return [from, to];
}

/**
 * The house's rooms and size as its page's text gives them, and where: in
 * the headline it leads with, or on lines of their own, whichever the page
 * says first. A page says its own house before the homes it goes on to
 * suggest, in whatever form either is written. Where it writes "4" over
 * "beds" and a card below says "3 bd 2 ba 1,480 sqft", the card is not the
 * headline; where it leads with "4 bd 3 ba 2,340 sqft" and a card below
 * lists "3 bd", "2 ba" on lines of their own, those lines are not the
 * house's. What comes second fills what the first left out only when it
 * agrees with it wherever both speak: then it is the same house said twice.
 */
function roomsOf(z: string, page: Stated): { rooms: ListingFacts; at?: [number, number] } {
  const summary = summaryNumbers(z);
  const led = headlineFacts({ beds: summary.beds, baths: summary.baths, sqft: summary.sqft }, "text");
  const stated: ListingFacts = {};
  const lines: number[] = [];
  for (const key of ROOMS) {
    if (page.facts[key]?.source !== "text" || page.where?.[key] === undefined) continue;
    stated[key] = page.facts[key];
    lines.push(page.where[key]!);
  }
  // Counted the way the fact reader counts lines: those that have something on them.
  const headlineLine = summary.at ? z.slice(0, z.lastIndexOf("\n", summary.at[0]) + 1).split("\n").filter((l) => l.trim()).length : Infinity;
  const sameHouse = ROOMS.every((key) => !led[key] || !stated[key] || led[key]!.value === stated[key]!.value);
  // Said twice, a number is kept as the line that states it: that one carries the page's own words.
  const both = mergeFacts(stated, led);
  if (lines.length && Math.min(...lines) <= headlineLine) {
    const first = Math.min(...lines);
    const last = Math.max(...lines);
    const span = lineSpan(z, first, last);
    // A label by itself on the last of those lines ("Sq Ft" / "2,340") has its value on the line under it.
    const labelOnly = !/\d/.test(z.slice(z.lastIndexOf("\n", span[1] - 1) + 1, span[1]));
    return { rooms: sameHouse ? both : stated, at: labelOnly ? lineSpan(z, first, last + 1) : span };
  }
  return { rooms: sameHouse ? both : led, at: summary.at };
}

/** A page's facts without the rooms and size its text states: those are settled by `roomsOf`, and what it left out was another home's. */
function withoutStatedRooms(facts: ListingFacts): ListingFacts {
  return Object.fromEntries(Object.entries(facts).filter(([key, fact]) => !((ROOMS as readonly string[]).includes(key) && fact.source === "text"))) as ListingFacts;
}

/**
 * The headline of a listing in free text (a copied page, a page's text, a
 * link preview): price, beds, baths, living area, address. `preview`: the
 * text is a link preview's sentence, read more warily.
 */
export function parseListingText(text: string, preview = false): Pick<ListingInfo, "price" | "beds" | "baths" | "sqft" | "address"> {
  const z = subjectZone(tidy(text));
  const summary = summaryNumbers(z, preview);
  const price = priceAt(z, summary.at);
  return { price: price?.value, beds: summary.beds, baths: summary.baths, sqft: summary.sqft, address: ownAddress(z, addressesIn(z, 8), summary.at, price?.at) };
}

/**
 * A listing page copied from the browser (select all, copy) arrives as HTML
 * plus plain text. Portals block server reads, but the user's own browser
 * already has the page, so this is the reliable path for Zillow and Redfin.
 * The copied text keeps its line breaks, which is what lets the description
 * and the detail lines be told apart from everything around them.
 *
 * The headline the page leads with comes first: it is the house's by where
 * it stands. What the page states further down on lines of their own fills
 * what the headline did not say, and the page's data fills the rest unless
 * it contradicts either (then it is another home's).
 *
 * The address: the one in the house's part of the text that is the link's
 * house, when the page was pasted for a link; else the one that stands with
 * the price and the rooms (`ownAddress`). Only when the text gives none is
 * the link's used, and the fact says which it was. The form compares the two
 * to tell whether the pasted page is the link's house.
 */
export function parsePastedListing(html: string, text: string, pageUrl?: string): Omit<ListingInfo, "url" | "host" | "fetched"> {
  const visible = text.trim() ? text : html ? pageText(html) : "";
  const z = subjectZone(tidy(visible));
  const linkAddress = pageUrl ? addressFromUrl(pageUrl) : undefined;
  const ld = html ? jsonLd(html) : [];
  const photos = html ? extractPhotos(html, pageUrl ?? "https://pasted.invalid/", undefined, ld) : [];
  const page = readPage({ html, text: visible, ld });
  const own = roomsOf(z, page);
  const price = priceAt(z, own.at);
  const said = addressesIn(z, 8);
  const theirs = linkAddress ? said.find((a) => sameAddress(a.address, linkAddress) === "same")?.address : undefined;
  // The page names the link's house without its address line being readable: it is still that house.
  const address = theirs ?? (linkAddress && mentionsHouse(z, linkAddress) ? undefined : ownAddress(z, said, own.at, price?.at));
  const lead = mergeFacts(headlineFacts({ address, price: price?.value }, "text"), own.rooms);
  const facts = mergeFacts(lead, withoutStatedRooms(contradicts(page.data, lead) ? withoutData(page.facts) : page.facts), headlineFacts({ address: linkAddress }, "link"));
  return { ...headlineOf(facts), photos, description: page.description, facts: someFacts(facts), details: page.details.length ? page.details : undefined };
}

/**
 * Facts + photos from a full listing page the person's browser fetched for
 * us. A check page shown to their browser is still not the listing, and is
 * reported as one.
 */
export function parseFetchedListing(url: string, html: string): ListingInfo {
  const { info } = readHtml(url, html);
  return info.fetched ? info : { ...info, note: `${info.host} showed your browser a check page instead of the listing.` };
}
