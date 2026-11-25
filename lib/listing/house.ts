import { sameAddress, type Same } from "./address";
import { addressFromUrl, type ListingInfo } from "./fetch-listing";

export { sameAddress, type Same } from "./address";

/**
 * Telling one house from another, and one listing page from another.
 *
 * A reading of a listing (a pasted page, what the button handed over, what
 * the extension fetched) is about one house. Nothing may put it under
 * another house's link: that is how one house's description and photos end
 * up in another's analysis. These are the comparisons the form and the API
 * use to keep them apart. Pure, bundled for the browser too.
 */

/**
 * What a link picks up on its way around that does not say which page it is:
 * campaign and share markers, and the parameters with a number for a name
 * that portals add for every way of sharing. Everything else after the "?"
 * may be the listing itself ("?listingId=2301234").
 */
const TRACKING = /^(?:utm_.+|\d+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|mibextid|si|ref|referrer|share|shared|rb|src|source|medium|campaign|cid|s_kwcid)$/i;

/** A link as the page it points at: its site, its path and the parameters that could matter. Null if it is not a web address. */
function pageKey(link: string): string | null {
  try {
    const u = new URL(link.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const params = [...u.searchParams.entries()]
      .filter(([name]) => !TRACKING.test(name))
      .map(([name, value]) => `${name}=${value}`)
      .sort()
      .join("&");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}${params ? `?${params}` : ""}`;
  } catch {
    return null;
  }
}

/** The link if it is a web address, else nothing: a street address typed into the link field is not the listing's link. */
export const webLink = (text: string): string => (pageKey(text) ? text.trim() : "");

export function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The same listing page, whatever was added to the link on its way here ("?utm_source=share"). */
export function sameLink(a: string, b: string): boolean {
  const first = pageKey(a);
  return first !== null && first === pageKey(b);
}

/** The address a reading's own page gave, as opposed to one read off its link. */
export function pageAddress(reading: Pick<ListingInfo, "address" | "facts">): string | undefined {
  const fact = reading.facts?.address;
  if (fact) return fact.source === "link" ? undefined : String(fact.value);
  return reading.address;
}

/**
 * Does this reading belong to this link? A reading made with a link in the
 * form belongs to that link and to no other. One made without (a page pasted
 * on its own) belongs to a link only when both say the same address; a link
 * that does not say its address (most brokerage sites) cannot claim it,
 * unless an earlier answer for that link said what its house is
 * (`linkAddress`).
 */
export function readingIsFor(reading: ListingInfo, link: string, linkAddress: string | undefined = addressFromUrl(link)): Same {
  if (!pageKey(link)) return "same";
  if (reading.url) return sameLink(reading.url, link) ? "same" : "different";
  return sameAddress(pageAddress(reading), linkAddress);
}

/**
 * Is a page just pasted the same house as the reading already held? Told by
 * the two addresses when both can be read. When they cannot, by what else a
 * listing leads with: another price, another number of bedrooms or another
 * size is another house, and a second piece of the same page agrees with the
 * first on whatever it repeats. With nothing to compare (a gallery pasted on
 * its own) there is no telling, and it is taken as more of the same page.
 */
export function sameHouse(held: ListingInfo, pasted: ListingInfo): Same {
  const byAddress = sameAddress(pageAddress(held) ?? held.address, pageAddress(pasted));
  if (byAddress !== "unknown") return byAddress;
  let agreed = 0;
  for (const key of ["price", "beds", "sqft"] as const) {
    if (held[key] === undefined || pasted[key] === undefined) continue;
    if (held[key] !== pasted[key]) return "different";
    agreed++;
  }
  return agreed ? "same" : "unknown";
}
