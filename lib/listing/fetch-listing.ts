/**
 * Best-effort listing metadata from a listing page's HTML or copied text.
 *
 * Reads the public Open Graph / meta tags and obvious text patterns only.
 * Pure parsing: this file is bundled for the browser too (the analyzer parses
 * a pasted page there). The server-side read of a link is read-listing.ts.
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
  /** Set when the pasted site blocked the server and the listing was read elsewhere. */
  readFrom?: { host: string; url: string; reason: string };
}

function meta(html: string, key: string): string[] {
  const out: string[] = [];
  // [^<>], here and below: an attribute run never crosses into the next tag. With [^>] a page
  // of unclosed "<meta " made every tag scan to the end of the page: seconds for 100 KB.
  const re = new RegExp(`<meta[^<>]+(?:property|name)=["']${key}["'][^<>]*>`, "gi");
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
const NOT_A_LISTING_PHOTO = /(?:logo|icon|sprite|avatar|favicon|badge|agent|headshot|map|pixel|tracking|placeholder|blank|spacer|\/svg\/|novaimgs|\/static\/|\/assets\/)/i;
export const MAX_LISTING_PHOTOS = 16;
const MAX_PHOTO_CANDIDATES = 400;
const MAX_LINK_CHARS = 2_000;
const MAX_JSON_LD_BLOCKS = 50;

/**
 * The bodies of the page's JSON-LD scripts, found by plain scanning. The
 * regex this replaces had a lazy "anything up to </script>" in it, which on a
 * page of script tags that are never closed rescans the rest of the page for
 * every tag. This is one pass: once no closing tag is left, it stops.
 */
function jsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  let at = 0;
  while (out.length < MAX_JSON_LD_BLOCKS) {
    const open = lower.indexOf("<script", at);
    if (open < 0) break;
    const tagEnd = lower.indexOf(">", open);
    if (tagEnd < 0) break;
    const close = lower.indexOf("</script>", tagEnd);
    if (close < 0) break;
    if (lower.slice(open, tagEnd).includes("application/ld+json")) out.push(html.slice(tagEnd + 1, close));
    at = close + "</script>".length;
  }
  return out;
}

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
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    // A listing has dozens of photos. A page offering thousands of "photos", or a link longer than any link, is not one.
    if (!raw || raw.length > MAX_LINK_CHARS || found.length >= MAX_PHOTO_CANDIDATES) return;
    let u = decode(raw.trim());
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

  for (const u of meta(html, "og:image")) push(u);
  for (const u of meta(html, "og:image:secure_url")) push(u);
  for (const u of meta(html, "twitter:image")) push(u);

  // JSON-LD: "image": "url" | ["url", ...] | {"url": ...}
  for (const body of jsonLdBlocks(html)) {
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
  for (const tag of html.match(/<(?:img|source)\b[^<>]*>/gi) ?? []) {
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
export function priceFromJsonLd(html: string): number | undefined {
  for (const body of jsonLdBlocks(html)) {
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
    try { walk(JSON.parse(body)); } catch { /* not JSON */ }
    if (found !== undefined) return found;
  }
  return undefined;
}

export function parseListingHtml(url: string, html: string): ListingInfo {
  const host = new URL(url).hostname.replace(/^www\./, "");
  // A title is a line and a description a paragraph; anything longer is cut before it is searched.
  const title = (meta(html, "og:title")[0] ?? html.match(/<title[^<>]*>([^<]*)<\/title>/i)?.[1]?.trim())?.slice(0, 300);
  const description = (meta(html, "og:description")[0] ?? meta(html, "description")[0] ?? "").slice(0, 2_000);
  const text = `${title ?? ""} | ${description}`;

  // Price: meta text first, then the listing's embedded JSON (portals put
  // the price in a data blob rather than in the description).
  const price =
    priceFromJsonLd(html) ??
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

/** A listing page's visible text is a few thousand characters; the facts are near the top. */
const MAX_PAGE_TEXT_CHARS = 200_000;

/** Facts from free text (a copied listing page): price, beds, baths, sqft, address. */
export function parseListingText(text: string): Pick<ListingInfo, "price" | "beds" | "baths" | "sqft" | "address"> {
  const t = text.slice(0, MAX_PAGE_TEXT_CHARS).replace(/\s+/g, " ");
  const price = num(t.match(/\$\s?([0-9]{3}(?:,[0-9]{3}){1,2})(?!\s*\/\s*(?:mo|month|sqft))/)?.[1]);
  const beds = num(t.match(/([0-9]+(?:\.[0-9])?)\s*(?:bd|bds|beds?|bedrooms?)\b/i)?.[1]);
  const baths = num(t.match(/([0-9]+(?:\.[0-9])?)\s*(?:ba|baths?|bathrooms?)\b/i)?.[1]);
  const sqft = num(t.match(/([0-9]{1,2},?[0-9]{3})\s*(?:sq\.?\s?ft|sqft|square feet)\b/i)?.[1]);
  // Bounded runs: a street is not 80 characters long, a city not 60. Unbounded, a long text
  // with digits and no commas made every digit scan to the end of it.
  const address = t.match(/\d{1,8} [A-Za-z0-9 .'#-]{1,80}?, ?[A-Za-z .'-]{1,60}, ?[A-Z]{2} ?\d{5}/)?.[0];
  return { price, beds, baths, sqft, address };
}

/**
 * A listing page copied from the browser (select all, copy) arrives as HTML
 * plus plain text. Portals block server reads, but the user's own browser
 * already has the page, so this is the reliable path for Zillow and Redfin.
 */
export function parsePastedListing(html: string, text: string, pageUrl?: string): Omit<ListingInfo, "url" | "host" | "fetched"> {
  const facts = parseListingText(text || html.replace(/<[^<>]+>/g, " "));
  const photos = html ? extractPhotos(html, pageUrl ?? "https://pasted.invalid/") : [];
  return { ...facts, address: facts.address ?? (pageUrl ? addressFromUrl(pageUrl) : undefined), photos };
}

/** Facts + photos from a full listing page the browser fetched for us. */
export function parseFetchedListing(url: string, html: string): ListingInfo {
  const base = parseListingHtml(url, html);
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^<>]+>/g, " ");
  const facts = parseListingText(text);
  return {
    ...base,
    fetched: true,
    note: undefined,
    price: base.price ?? facts.price,
    beds: base.beds ?? facts.beds,
    baths: base.baths ?? facts.baths,
    sqft: base.sqft ?? facts.sqft,
    address: base.address ?? facts.address ?? addressFromUrl(url),
  };
}
