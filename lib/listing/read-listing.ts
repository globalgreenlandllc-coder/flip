import { UnsafeUrlError, safeFetch } from "@/lib/net/safe-fetch";
import { addressFromUrl, parseListingHtml, type ListingInfo } from "./fetch-listing";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_HTML_BYTES = 4_000_000;

/**
 * Read a listing page from a pasted link, on the server. Zillow, Redfin and
 * Realtor.com block this most of the time; when that happens we say so and
 * the person brings the photos another way. The link is whatever was pasted,
 * so it goes through safeFetch: public internet only, a size cap, a deadline.
 * Server only (safeFetch uses node:http); the parsing lives in fetch-listing.ts.
 */
export async function fetchListing(url: string, timeoutMs = 8000): Promise<ListingInfo> {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* not a web address: safeFetch refuses it below */
  }
  const miss = (note: string): ListingInfo => ({ url, host, fetched: false, note, address: addressFromUrl(url), photos: [] });
  try {
    const res = await safeFetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, timeoutMs, maxBytes: MAX_HTML_BYTES });
    if (!res.ok) return miss(`${host} returned ${res.status}. Upload the listing photos instead.`);
    return parseListingHtml(url, res.body.toString("utf8"));
  } catch (err) {
    if (err instanceof UnsafeUrlError) return miss("That link cannot be read from here. Upload the listing photos instead.");
    const why = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached";
    return miss(`${host} ${why}. Upload the listing photos instead.`);
  }
}
