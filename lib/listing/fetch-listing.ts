/**
 * Best-effort listing metadata from a pasted URL.
 *
 * Reads the public Open Graph / meta tags and obvious text patterns only.
 * Zillow, Redfin and Realtor.com block automated fetches most of the time;
 * when that happens we say so and the user uploads the photos instead.
 * This deliberately does not scrape listing pages beyond their meta tags.
 */

export interface ListingInfo {
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
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function meta(html: string, key: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "gi");
  for (const tag of html.match(re) ?? []) {
    const m = tag.match(/content=["']([^"']*)["']/i);
    if (m?.[1]) out.push(decode(m[1]));
  }
  return out;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const PHOTO_EXT = /\.(?:jpe?g|png|webp)(?:$|[?#])/i;
const NOT_A_LISTING_PHOTO = /(?:logo|icon|sprite|avatar|favicon|badge|agent|headshot|map|pixel|tracking|placeholder|blank|spacer|\/svg\/)/i;
export const MAX_LISTING_PHOTOS = 16;

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
export function extractPhotos(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    let u = decode(raw.trim());
    if (u.startsWith("//")) u = "https:" + u;
    else if (u.startsWith("/")) {
      try { u = new URL(u, pageUrl).toString(); } catch { return; }
    }
    if (!/^https?:\/\//.test(u)) return;
    if (NOT_A_LISTING_PHOTO.test(u)) return;
    if (!PHOTO_EXT.test(u) && !/(?:photo|image|img|picture|media|cdn)/i.test(u)) return;
    if (!found.includes(u)) found.push(u);
  };

  for (const u of meta(html, "og:image")) push(u);
  for (const u of meta(html, "og:image:secure_url")) push(u);
  for (const u of meta(html, "twitter:image")) push(u);

  // JSON-LD: "image": "url" | ["url", ...] | {"url": ...}
  for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        const obj = node as Record<string, unknown>;
        const urlOf = (i: unknown): string | undefined =>
          typeof i === "string" ? i : (i as { url?: string; contentUrl?: string } | null)?.url ?? (i as { contentUrl?: string } | null)?.contentUrl;
        for (const key of ["image", "photo", "photos", "contentUrl"]) {
          const img = obj[key];
          if (Array.isArray(img)) img.forEach((i) => push(urlOf(i)));
          else if (img) push(urlOf(img));
        }
        for (const v of Object.values(obj)) if (v && typeof v === "object") walk(v);
      };
      walk(JSON.parse(body));
    } catch {
      /* not JSON, skip */
    }
  }

  // Gallery images.
  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) ?? []) {
    const srcset = tag.match(/\b(?:srcset|data-srcset)=["']([^"']+)["']/i)?.[1];
    if (srcset) push(biggestInSrcset(srcset));
    const src = tag.match(/\b(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i)?.[1];
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
  const name = u.split("/").pop() ?? "";
  const nums = (name.match(/\d{3,4}/g) ?? []).map(Number).filter((n) => n >= 200 && n <= 8000);
  return nums.length ? Math.max(...nums) : 0;
}

export function parseListingHtml(url: string, html: string): ListingInfo {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const title = meta(html, "og:title")[0] ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const description = meta(html, "og:description")[0] ?? meta(html, "description")[0] ?? "";
  const text = `${title ?? ""} | ${description}`;

  // Price: meta text first, then the listing's embedded JSON (portals put
  // the price in a data blob rather than in the description).
  const price =
    num(text.match(/\$\s?([0-9]{2,3}(?:,[0-9]{3})+|[0-9]{5,8})/)?.[1]) ??
    num(html.match(/\\?"(?:listPrice|unformattedPrice|price)\\?":\s*\\?"?\$?([0-9]{5,8})/)?.[1]);
  const beds = num(text.match(/([0-9]+(?:\.[0-9])?)\s*(?:bd|bds|bed|beds|bedroom)/i)?.[1]);
  const baths = num(text.match(/([0-9]+(?:\.[0-9])?)\s*(?:ba|bath|baths|bathroom)/i)?.[1]);
  const sqft = num(text.match(/([0-9]{1,2},?[0-9]{3})\s*(?:sq\.?\s?ft|sqft|square feet)/i)?.[1]);

  // Address: og:title on most portals is "123 Main St, City, ST 98103 | ..." or similar.
  const address = title?.split(/\s[|\-–]\s/)[0]?.match(/\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/)?.[0] ?? addressFromUrl(url);

  const photos = extractPhotos(html, url);

  const blocked = /captcha|access denied|are you a human|px-captcha|robot/i.test(html) && photos.length === 0;
  return {
    url,
    host,
    fetched: !blocked,
    note: blocked ? `${host} blocked automated access. Upload the listing photos instead.` : undefined,
    title,
    address,
    price,
    beds,
    baths,
    sqft,
    photos,
  };
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
  // Street is greedy and the city is the last token before the state, so
  // "13013-224th-St-E-Graham-WA-98338" splits at Graham, not at St.
  const z = path.match(/\/homedetails\/(.+)-([A-Za-z.']+)-([A-Z]{2})-(\d{5})\//);
  if (z) return `${title(z[1])}, ${title(z[2])}, ${z[3]} ${z[4]}`;
  // Redfin: /<ST>/<City>/<street>-<zip>/home/<id>
  const r = path.match(/^\/([A-Z]{2})\/([^/]+)\/(.+?)-(\d{5})\/home\//);
  if (r) return `${title(r[3])}, ${title(r[2])}, ${r[1]} ${r[4]}`;
  // Realtor: /realestateandhomes-detail/<street>_<City>_<ST>_<zip>_<id>
  const m = path.match(/\/realestateandhomes-detail\/([^_]+)_([^_]+)_([A-Z]{2})_(\d{5})/);
  if (m) return `${title(m[1])}, ${title(m[2])}, ${m[3]} ${m[4]}`;
  return undefined;
}

export async function fetchListing(url: string, timeoutMs = 8000): Promise<ListingInfo> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });
    const html = await res.text();
    if (!res.ok) {
      return { url, host, fetched: false, note: `${host} returned ${res.status}. Upload the listing photos instead.`, address: addressFromUrl(url), photos: [] };
    }
    return parseListingHtml(url, html);
  } catch (err) {
    const why = err instanceof Error && err.name === "AbortError" ? "timed out" : "could not be reached";
    return { url, host, fetched: false, note: `${host} ${why}. Upload the listing photos instead.`, address: addressFromUrl(url), photos: [] };
  } finally {
    clearTimeout(timer);
  }
}
