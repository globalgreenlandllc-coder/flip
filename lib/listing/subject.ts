import type { PropertyFacts } from "@/lib/engine/types";
import type { ListingInfo, ListingVia } from "./fetch-listing";
import { MAX_DETAILS, factNumber, mergeFacts, saneFact, type FactKey, type ListingDescription, type ListingFacts } from "./listing-facts";

/**
 * Which of the house's facts the analysis may take from its listing, and a
 * record of where each fact it used came from. A result built on a made-up
 * property record must be able to say, fact by fact, which parts were real.
 */
export const SUBJECT_KEYS = ["sqft", "lotSqft", "beds", "baths", "yearBuilt", "garage"] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];

/**
 * listing - read off the listing page
 * caller  - sent with the request
 * record  - the data provider's property record (made up while the provider is the demo one)
 */
export type SubjectSource = "listing" | "caller" | "record";
export type SubjectSources = Record<SubjectKey, SubjectSource>;

export type SubjectNumbers = Partial<Pick<PropertyFacts, SubjectKey>>;

/**
 * The numbers a listing gives about the house that the valuation may use:
 * living area, bedrooms and bathrooms (the line every listing leads with),
 * and the year built when the page states it on a line of its own or in its
 * data. Each only if it is a sane value for what it is.
 *
 * Not the lot and not the garage, though the listing's reading of them is
 * kept and shown. Both move the price of every comp by a per-unit amount,
 * the lot's is a placeholder that is far too high for acreage, and a
 * misread lot ("on a 1/4 acre lot") once emptied the comp set of a house
 * altogether. They come back when the lot adjustment is rebuilt against real
 * sales. And never a loose reading: a year found in a sentence may be the
 * shop's.
 */
export function subjectFromListing(listing: ListingInfo | null | undefined): SubjectNumbers {
  if (!listing) return {};
  const out: SubjectNumbers = {};
  const take = (key: "sqft" | "beds" | "baths" | "yearBuilt", value: unknown) => {
    if (out[key] !== undefined) return;
    const fact = saneFact(key as FactKey, { value, source: "text" });
    // A listing that says 0 beds or 0 baths has not said how many there are.
    if (fact && typeof fact.value === "number" && fact.value > 0) out[key] = fact.value;
  };
  take("sqft", listing.sqft);
  take("beds", listing.beds);
  take("baths", listing.baths);
  for (const key of ["sqft", "beds", "baths", "yearBuilt"] as const) take(key, factNumber(listing.facts, key));
  return out;
}

/** Where each fact of the subject came from, given what the caller sent and what the listing gave. */
export function sourcesOf(caller: SubjectNumbers, listing: SubjectNumbers): SubjectSources {
  return Object.fromEntries(SUBJECT_KEYS.map((key) => [key, caller[key] !== undefined ? "caller" : listing[key] !== undefined ? "listing" : "record"])) as SubjectSources;
}

const HEADLINE = ["price", "beds", "baths", "sqft"] as const;

/** How much a description can be relied on to be the listing's own: one found under its heading or in the page's data, then a guess at it, then a link preview's summary. */
const rank = (d: ListingDescription | undefined) => (!d ? 0 : d.source === "meta" ? 1 : d.unsure ? 2 : 3);

/**
 * One listing read two ways: `mine` first (a pasted page, what the person's
 * browser fetched), `theirs` for what the first lacked (usually the photos,
 * read by the server). The first reading wins field by field and the second
 * fills the gaps, and the result says both ways it was read.
 *
 * The line a person sees ("4 bd · 2,340 sqft") and the facts beside it are
 * settled together: a number is never one reading's in the line and the
 * other's in the facts.
 */
export function mergeListings(mine: ListingInfo, theirs: ListingInfo): ListingInfo {
  const facts: ListingFacts = mergeFacts(mine.facts, theirs.facts);
  const headline: Partial<Record<(typeof HEADLINE)[number], number>> = {};
  for (const key of HEADLINE) {
    const own = mine[key] ?? factNumber(mine.facts, key);
    headline[key] = own ?? theirs[key] ?? factNumber(theirs.facts, key);
    // The first reading gave the number without a fact for it: the second reading's fact, if it says otherwise, is not kept beside it.
    if (own !== undefined && facts[key]?.value !== own) delete facts[key];
  }
  const address = mine.address ?? theirs.address;
  if (mine.address && facts.address?.value !== mine.address) delete facts.address;

  const details = [...(mine.details ?? [])];
  for (const d of theirs.details ?? []) {
    if (details.length >= MAX_DETAILS) break;
    if (!details.some((have) => have.label === d.label && have.value.toLowerCase() === d.value.toLowerCase())) details.push(d);
  }

  const first = mine.read ?? theirs.read;
  const others = [mine.read, theirs.read].flatMap((r) => (r ? [r.via, ...(r.with ?? [])] : [])).filter((via, i, all): via is ListingVia => via !== first?.via && all.indexOf(via) === i);

  return {
    url: mine.url || theirs.url,
    host: mine.host || theirs.host,
    fetched: mine.fetched || theirs.fetched,
    // Why the second reading failed is not a note on a listing the first one read.
    note: mine.fetched ? undefined : theirs.note,
    title: mine.title ?? theirs.title,
    address,
    ...headline,
    photos: mine.photos.length ? mine.photos : theirs.photos,
    description: rank(theirs.description) > rank(mine.description) ? theirs.description : mine.description,
    facts: Object.keys(facts).length ? facts : undefined,
    details: details.length ? details : undefined,
    read: first ? { at: first.at, via: first.via, ...(others.length ? { with: others } : {}) } : undefined,
    readFrom: theirs.readFrom ?? mine.readFrom,
  };
}
