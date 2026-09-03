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

export function parseListingHtml(url: string, html: string): ListingInfo {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const title = meta(html, "og:title")[0] ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const description = meta(html, "og:description")[0] ?? meta(html, "description")[0] ?? "";
  const text = `${title ?? ""} | ${description}`;

  const price = num(text.match(/\$\s?([0-9]{2,3}(?:,[0-9]{3})+|[0-9]{5,8})/)?.[1]);
  const beds = num(text.match(/([0-9]+(?:\.[0-9])?)\s*(?:bd|bds|bed|beds|bedroom)/i)?.[1]);
  const baths = num(text.match(/([0-9]+(?:\.[0-9])?)\s*(?:ba|bath|baths|bathroom)/i)?.[1]);
  const sqft = num(text.match(/([0-9]{1,2},?[0-9]{3})\s*(?:sq\.?\s?ft|sqft|square feet)/i)?.[1]);

  // Address: og:title on most portals is "123 Main St, City, ST 98103 | ..." or similar.
  const address = title?.split(/\s[|\-–]\s/)[0]?.match(/\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/)?.[0];

  const photos = [...new Set([...meta(html, "og:image"), ...meta(html, "twitter:image")])].filter((u) => /^https?:\/\//.test(u));

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
      return { url, host, fetched: false, note: `${host} returned ${res.status}. Upload the listing photos instead.`, photos: [] };
    }
    return parseListingHtml(url, html);
  } catch (err) {
    const why = err instanceof Error && err.name === "AbortError" ? "timed out" : "could not be reached";
    return { url, host, fetched: false, note: `${host} ${why}. Upload the listing photos instead.`, photos: [] };
  } finally {
    clearTimeout(timer);
  }
}
