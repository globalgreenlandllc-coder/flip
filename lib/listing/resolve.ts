import { addressFromUrl, fetchListing, type ListingInfo } from "./fetch-listing";

/**
 * When a portal blocks the server (Zillow, Redfin, Realtor, Trulia), find the
 * same MLS listing on a site that serves it. Estately keys its listing pages
 * by address, so the pasted link's address is enough.
 */

const ABBREV: [RegExp, string][] = [
  [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\bcourt\b/g, "ct"], [/\bdrive\b/g, "dr"], [/\broad\b/g, "rd"],
  [/\blane\b/g, "ln"], [/\bplace\b/g, "pl"], [/\bboulevard\b/g, "blvd"], [/\bcircle\b/g, "cir"], [/\bterrace\b/g, "ter"],
  [/\bhighway\b/g, "hwy"], [/\bparkway\b/g, "pkwy"], [/\btrail\b/g, "trl"], [/\bway\b/g, "way"],
];
const EXPAND: [RegExp, string][] = ABBREV.map(([re, short]) => [new RegExp(`\\b${short}\\b`, "g"), re.source.replace(/\\b/g, "")]);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "8208 243rd Street Ct E, Graham, WA 98338" -> candidate Estately URLs, most likely first. */
export function estatelyCandidates(address: string): string[] {
  const m = address.match(/^\s*(.+?),\s*([^,]+?),\s*([A-Z]{2})\s*(\d{5})\s*$/i);
  if (!m) return [];
  const [, street, city, st, zip] = m;
  const tail = `${slug(city)}-${st.toLowerCase()}-${zip}`;
  const variants = new Set<string>();
  const base = street.toLowerCase();
  variants.add(base);
  variants.add(ABBREV.reduce((acc, [re, short]) => acc.replace(re, short), base));
  variants.add(EXPAND.reduce((acc, [re, long]) => acc.replace(re, long), base));
  return [...variants].map((v) => `https://www.estately.com/listings/info/${slug(v)}-${tail}`);
}

export interface ResolvedListing extends ListingInfo {
  readFrom: { host: string; url: string; reason: string };
}

/** Try the alternates; the first page with photos for the same zip wins. */
export async function resolveByAddress(address: string, blockedHost: string): Promise<ResolvedListing | null> {
  const zip = address.match(/(\d{5})\s*$/)?.[1];
  for (const url of estatelyCandidates(address)) {
    const info = await fetchListing(url, 10_000);
    if (!info.fetched || info.photos.length === 0) continue;
    if (zip && !(info.title ?? "").includes(zip) && !(info.address ?? "").includes(zip)) continue;
    return {
      ...info,
      address: info.address ?? address,
      readFrom: { host: "estately.com", url, reason: `${blockedHost} blocked the server, so the same MLS listing was read from Estately.` },
    };
  }
  return null;
}

/** Address for a blocked link: from the page if we got one, else from the URL. */
export function addressForBlocked(listing: ListingInfo): string | undefined {
  return listing.address ?? addressFromUrl(listing.url);
}
