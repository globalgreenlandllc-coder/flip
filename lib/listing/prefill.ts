import { dedupePhotos, parseListingText } from "./fetch-listing";

/**
 * What the analyzer form can be pre-filled with: from the "flip it" bookmark
 * (query string) or from a pasted listing page.
 */
export interface Prefill {
  listingUrl?: string;
  photos: string[];
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  address?: string;
}

const isHttp = (u: string) => /^https?:\/\/\S+$/i.test(u);

/** Query string from the bookmark: listing, photos (comma-separated), text (page text), price. */
export function prefillFromParams(params: Record<string, string | string[] | undefined>): Prefill | null {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const listingUrl = one("listing");
  const photos = dedupePhotos((one("photos") ?? "").split(/[,\n\s]+/).map((s) => s.trim()).filter(isHttp)).slice(0, 30);
  const facts = parseListingText(one("text") ?? "");
  const price = Number(one("price")) > 0 ? Number(one("price")) : facts.price;
  if (!listingUrl && !photos.length && !price) return null;
  return { listingUrl: listingUrl && isHttp(listingUrl) ? listingUrl : undefined, photos, price, beds: facts.beds, baths: facts.baths, sqft: facts.sqft, address: facts.address };
}
