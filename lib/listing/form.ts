import { addressFromUrl, type ListingInfo } from "./fetch-listing";
import { hostOf, pageAddress, readingIsFor, sameAddress, sameHouse, sameLink, webLink } from "./house";
import type { Prefill } from "./prefill";
import { mergeListings } from "./subject";

/**
 * What the analyzer form holds about the house, and the rule it keeps: one
 * house at a time.
 *
 * A reading of a listing (a pasted page, what the button on the listing page
 * handed over, what the extension fetched) fills the photo-links box and the
 * price. When the person then moves on to another house, by giving another
 * link or pasting another house's page, all of that has to go with it. Left
 * behind, the first house's description, photos and price were sent with the
 * second house's link, and the result looked like an analysis of the second
 * house.
 *
 * So the form remembers what a reading filled in and takes exactly that out
 * again when the reading is set aside, and the asking price with it, typed or
 * not: a price is a house's. Photos the person added themselves (dropped
 * links, uploaded files) are theirs to keep or remove: the form does not
 * guess, it says they are still there and does not start by itself while
 * they are. These are plain functions over a plain value so that every one
 * of those moves can be tested without a browser.
 */
export interface HouseForm {
  /** The listing-link field, as typed. */
  link: string;
  /** The photo-links box, one link per line. */
  photoLinks: string;
  /** The asking-price field, as typed. */
  price: string;
  /** The listing as this browser read it, if it did. */
  read: ListingInfo | null;
  /** What that reading put into the two boxes above. */
  filled: { photos: string[]; price: string | null };
  /** The link the last analysis ran for ("" if it ran without one); null before any has run. */
  ran: string | null;
  /** What the last answer said a link's house is, for the links that do not say it themselves. */
  known: { link: string; address: string } | null;
  /** Said once, by the form, when a reading was set aside, the link cleared, or an analysis not started by itself. */
  notice: string | null;
}

export type PastedPage = Omit<ListingInfo, "url" | "host" | "fetched">;

const NOTICE = {
  otherHousePasted: "The page you pasted is a different house from the one that was here, so the form started over with it.",
  linkWasNotThisPage: "The page you pasted is a different house from the link in the form, so the link was cleared.",
  otherLink: "This link is a different listing from the page that was read before, so that page, its photo links and the asking price were taken out.",
  otherLinkNoPage: "This link is a different listing from the last one, so the asking price was taken out.",
  cannotTell: "RenoFlip could not tell whether the page you pasted is this link's listing, so that page, its photo links and the asking price were taken out. To use it, paste the page again now that the link is in the form.",
  held: "The link is in. The analysis did not start by itself because the form holds photos or a price you added yourself: press Analyze when they are this house's.",
};

const words = (box: string) => box.split(/\s+/).filter(Boolean);

/** The photo links in the box that no reading put there: dropped or typed in by the person. */
export function ownPhotoLinks(form: HouseForm): string[] {
  const theirs = new Set(form.filled.photos);
  return words(form.photoLinks).filter((link) => !theirs.has(link));
}

/** What to add to a notice when photos of the person's own are still in the form after it moved to another house. */
function stillHere(form: HouseForm, uploads: number): string {
  const own = ownPhotoLinks(form).length + uploads;
  return own ? ` The ${own === 1 ? "photo" : `${own} photos`} you added yourself ${own === 1 ? "is" : "are"} still in the form: take ${own === 1 ? "it" : "them"} out if ${own === 1 ? "it is" : "they are"} the other house's.` : "";
}

export function formFromPrefill(prefill: Prefill | null | undefined): HouseForm {
  const price = prefill?.price ? String(prefill.price) : "";
  return {
    link: prefill?.listingUrl ?? "",
    photoLinks: prefill?.photos.join("\n") ?? "",
    price,
    read: prefill?.listing ?? null,
    filled: { photos: prefill?.photos ?? [], price: price || null },
    ran: null,
    known: null,
    notice: null,
  };
}

/** The form without its reading, without what the reading filled in, and without a price: the next house's is not this one's. */
function setAside(form: HouseForm, notice: string | null, uploads = 0): HouseForm {
  const theirs = new Set(form.filled.photos);
  const next: HouseForm = { ...form, photoLinks: words(form.photoLinks).filter((link) => !theirs.has(link)).join("\n"), price: "", read: null, filled: { photos: [], price: null } };
  return { ...next, notice: notice === null ? null : `${notice}${stillHere(next, uploads)}` };
}

/**
 * A reading put into the form: its photo links into the box, and its price
 * into the field unless the person typed one of their own. Both are
 * remembered as the reading's.
 */
function fill(form: HouseForm, reading: ListingInfo, photos: string[]): HouseForm {
  const have = new Set(words(form.photoLinks));
  const added = photos.filter((link, i) => !have.has(link) && photos.indexOf(link) === i);
  const typed = form.price.trim() !== "" && form.price !== form.filled.price;
  const price = reading.price ? String(reading.price) : null;
  return {
    ...form,
    photoLinks: [...words(form.photoLinks), ...added].join("\n"),
    price: typed ? form.price : (price ?? ""),
    read: reading,
    filled: { photos: [...form.filled.photos, ...added], price: typed ? form.filled.price : price },
  };
}

/** Photo links the person dropped or pasted in themselves. Null if the text held none. */
export function photoLinksAdded(form: HouseForm, text: string): HouseForm | null {
  const links = words(text).filter((link) => /^https?:\/\/\S+$/.test(link));
  if (!links.length) return null;
  return { ...form, photoLinks: [...new Set([...words(form.photoLinks), ...links])].join("\n") };
}

/** The address of the house a link is for: said by the link itself, or by the last answer for that link. */
function houseOf(form: HouseForm, link: string): string | undefined {
  return addressFromUrl(link) ?? (form.known && sameLink(form.known.link, link) ? form.known.address : undefined);
}

/**
 * A whole listing page pasted from the browser. Null if there was nothing of
 * a listing in it.
 *
 * It joins what is already in the form unless it is plainly another house:
 * its page gives another address, or where the addresses do not tell, another
 * price, another number of bedrooms or another size. A second paste is
 * usually the rest of the same page, or its gallery, and agrees with the
 * first on whatever it repeats. When it is another house the form starts
 * over with it, and a link that belonged to the first house is cleared: the
 * request must not carry one house's link with another's page.
 */
export function pagePasted(form: HouseForm, page: PastedPage, now: Date, uploads = 0): HouseForm | null {
  if (!page.photos.length && !page.price && !page.address && !page.beds && !page.description) return null;
  const link = webLink(form.link);
  let next: HouseForm = { ...form, notice: null };
  let incoming: ListingInfo = { ...page, url: link, host: hostOf(link), fetched: true, read: { at: now.toISOString(), via: "paste" } };
  /** The page without the link: not its link, and not an address that was only read off that link. */
  const unlinked = (): ListingInfo => {
    const fromLink = incoming.facts?.address?.source === "link";
    const facts = fromLink ? Object.fromEntries(Object.entries(incoming.facts ?? {}).filter(([key]) => key !== "address")) : incoming.facts;
    return { ...incoming, url: "", host: "", address: fromLink ? undefined : incoming.address, facts: facts && Object.keys(facts).length ? facts : undefined };
  };

  // The link in the form was changed since the last reading: that reading is not this link's, and the page being pasted is.
  const stale = next.read && link ? readingIsFor(next.read, link, houseOf(next, link)) : "same";
  if (stale !== "same") next = setAside(next, stale === "different" ? NOTICE.otherLink : NOTICE.cannotTell, uploads);

  if (next.read && sameHouse(next.read, incoming) === "different") {
    const linkWasTheirs = Boolean(link && next.read.url && sameLink(next.read.url, link));
    next = setAside(next, NOTICE.otherHousePasted, uploads);
    if (linkWasTheirs) {
      next.link = "";
      incoming = unlinked();
    }
  }
  // The link in the form is for one house and the page that was pasted says it is another.
  if (incoming.url && sameAddress(pageAddress(incoming), houseOf(next, incoming.url)) === "different") {
    const cleared = setAside({ ...next, link: "" }, next.notice ?? NOTICE.linkWasNotThisPage, uploads);
    next = { ...cleared, notice: next.notice ?? cleared.notice };
    incoming = unlinked();
  }

  const held = next.read;
  // Two readings of one house: the one with the fuller description leads, the other fills its gaps.
  const leads = held && !(incoming.description && (!held.description || incoming.description.text.length > held.description.text.length));
  const reading = held ? (leads ? mergeListings(held, incoming) : mergeListings(incoming, held)) : incoming;
  return fill(next, reading, page.photos);
}

/**
 * The link an analysis is about to run for. A reading that is not this
 * link's is set aside with what it filled in, and so is the asking price
 * when the link is another listing than the last one analysed. A reading
 * that is this link's stays, and one pasted without a link takes this link
 * when both name the same house.
 */
export function linkGiven(form: HouseForm, given: string, uploads = 0): HouseForm {
  const link = given.trim();
  const next: HouseForm = { ...form, link, notice: null };
  if (form.read) {
    const belongs = readingIsFor(form.read, link, houseOf(form, link));
    if (belongs !== "same") return setAside(next, belongs === "different" ? NOTICE.otherLink : NOTICE.cannotTell, uploads);
    return webLink(link) && !form.read.url ? { ...next, read: { ...form.read, url: link, host: hostOf(link) } } : next;
  }
  // No reading to go by, but the last analysis was for another listing: what is left of it in the form is the price.
  if (form.ran && webLink(link) && !sameLink(form.ran, link) && form.price.trim()) return setAside(next, NOTICE.otherLinkNoPage, uploads);
  return next;
}

/**
 * A link pasted into the link field starts its analysis by itself, but only
 * when everything in the form is that link's: no photos or price the person
 * put in themselves, which may be another house's. Then the form waits for
 * them to press Analyze, and says why.
 */
export function linkPasted(form: HouseForm, link: string, uploads = 0): { form: HouseForm; start: boolean } {
  const next = linkGiven(form, link, uploads);
  const own = ownPhotoLinks(next).length + uploads > 0 || (next.price.trim() !== "" && next.price !== next.filled.price);
  return own ? { form: { ...next, notice: next.notice ?? NOTICE.held }, start: false } : { form: next, start: true };
}

/** The link's page as the person's browser fetched it (the extension). It joins a page already pasted for this link instead of replacing it. */
export function browserRead(form: HouseForm, listing: ListingInfo): HouseForm {
  return fill(form, form.read ? mergeListings(form.read, listing) : listing, listing.photos);
}

/** An analysis is starting for this form's link: remembered, so the next link can be told from it. */
export function analysisStarted(form: HouseForm): HouseForm {
  return { ...form, ran: webLink(form.link) };
}

/** What an answer said the link's house is. Kept for links that do not carry their address, so a page pasted under one can be told from it. */
export function houseLearned(form: HouseForm, link: string, address: string | undefined): HouseForm {
  return webLink(link) && address ? { ...form, known: { link: webLink(link), address } } : form;
}

/**
 * The reading as it travels with the request: under the form's link when it
 * has none of its own, and without its photo links. Those are in the box,
 * where the person can see and remove them, and only what is in the box is
 * looked at.
 */
export function listingToSend(form: HouseForm): ListingInfo | undefined {
  if (!form.read) return undefined;
  const link = webLink(form.link);
  return { ...form.read, url: form.read.url || link, host: form.read.host || hostOf(link), photos: [] };
}
