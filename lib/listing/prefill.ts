import { dedupePhotos, parsePastedListing, type ListingInfo } from "./fetch-listing";
import { hostOf } from "./house";
import { saneFact } from "./listing-facts";

/**
 * What the analyzer form can be pre-filled with: from the "flip it" bookmark
 * or the extension's button on a listing page (both hand over the link, the
 * photo links and the first of the page's text in the query string).
 */
export interface Prefill {
  listingUrl?: string;
  photos: string[];
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  address?: string;
  /** The page as far as it was handed over, read like any other: its facts with their sources. */
  listing: ListingInfo;
}

const isHttp = (u: string) => /^https?:\/\/\S+$/i.test(u);
/** The button sends 2,000 characters; a query string is not the place for more. */
const MAX_TEXT_CHARS = 4_000;

/** Query string from the bookmark: listing, photos (comma-separated), text (page text), price. */
export function prefillFromParams(params: Record<string, string | string[] | undefined>, now: Date = new Date()): Prefill | null {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const given = one("listing");
  const listingUrl = given && given.length <= 2_000 && isHttp(given) ? given : undefined;
  const photos = dedupePhotos((one("photos") ?? "").split(/[,\n\s]+/).map((s) => s.trim()).filter(isHttp)).slice(0, 30);
  const read = parsePastedListing("", (one("text") ?? "").slice(0, MAX_TEXT_CHARS), listingUrl);
  // A price handed over beside the text is the page's own, read by whoever handed it over: it
  // is the listing's price here, in the line and in the facts alike.
  const handed = saneFact("price", { value: Number(one("price")), source: "text" });
  const price = handed ? (handed.value as number) : read.price;
  if (!listingUrl && !photos.length && !price) return null;
  const facts = handed ? { ...read.facts, price: handed } : read.facts;
  const listing: ListingInfo = { ...read, url: listingUrl ?? "", host: listingUrl ? hostOf(listingUrl) : "", fetched: true, price, facts, photos, read: { at: now.toISOString(), via: "button" } };
  return { listingUrl, photos, price, beds: read.beds, baths: read.baths, sqft: read.sqft, address: read.address, listing };
}
