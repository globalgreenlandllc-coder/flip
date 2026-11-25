import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFetchedListing, parsePastedListing } from "./fetch-listing.ts";
import { analysisStarted, browserRead, formFromPrefill, houseLearned, linkGiven, linkPasted, listingToSend, pagePasted, photoLinksAdded, type HouseForm } from "./form.ts";
import { readingIsFor, sameAddress, sameLink, webLink } from "./house.ts";
import { prefillFromParams } from "./prefill.ts";

/**
 * The analyzer form holds one house at a time. These are the ways a person
 * moves from one house to the next in it, each of which once sent the first
 * house's page, photos or price along with the second house's link.
 *
 * Two houses, written by hand the way a copied listing page arrives: the
 * visible text, and HTML with the gallery images. No listing site was read.
 */
const photo = (letter: string) => `https://photos.zillowstatic.com/fp/${letter.repeat(32)}-cc_ft_1536.jpg`;
const X = {
  url: "https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/1_zpid/",
  text: ["Buy", "Rent", "Sell", "$549,000", "13013 224th St E, Graham, WA 98338", "4 bd 3 ba 2,340 sqft", "Built in 1987", "Description",
    "HOUSE X. Sold as-is. Cash or rehab loan only: the septic system failed inspection in 2025 and the county requires a new drainfield. Seller has never occupied the property.",
    "Facts & features", "Sewer: Septic Tank", "Listing terms: Cash, Rehab Loan"].join("\n"),
  html: `<div><img src="${photo("a")}"><img src="${photo("b")}"></div>`,
  photos: [photo("a"), photo("b")],
};
const Y = {
  url: "https://www.zillow.com/homedetails/9-Other-Rd-Tacoma-WA-98402/2_zpid/",
  text: ["Buy", "Rent", "Sell", "$310,000", "9 Other Rd, Tacoma, WA 98402", "2 bd 1 ba 850 sqft", "Built in 2004", "Description",
    "HOUSE Y. Move-in ready condo close to the light rail. New roof, new furnace and fresh paint throughout. The association covers water and exterior maintenance.",
    "Facts & features", "Sewer: Public Sewer"].join("\n"),
  html: `<div><img src="${photo("c")}"></div>`,
  photos: [photo("c")],
};
const NOW = new Date("2026-11-24T20:00:00.000Z");
const empty = (): HouseForm => formFromPrefill(null);
/** Paste a copied page into the form, as the form does it: the page is read with the link that is in the field. */
const paste = (form: HouseForm, page: { html?: string; text: string }) => pagePasted(form, parsePastedListing(page.html ?? "", page.text, webLink(form.link) || undefined), NOW);
const links = (form: HouseForm) => form.photoLinks.split("\n").filter(Boolean);
const about = (form: HouseForm) => form.read?.description?.text.slice(0, 7);
const fromButton = (house: typeof X) => formFromPrefill(prefillFromParams({ listing: house.url, photos: house.photos.join(","), text: house.text.replace(/\s+/g, " ").slice(0, 2000) }, NOW));

test("two links are the same listing page whatever was added to them on the way, and two addresses the same house by number, street and zip", () => {
  assert.equal(sameLink(X.url, `${X.url}?utm_source=share&fbclid=abc#photos`), true);
  assert.equal(sameLink(X.url, X.url.replace("https://www.", "http://").replace(/\/$/, "")), true);
  assert.equal(sameLink(X.url, Y.url), false);
  // A parameter that could be the listing itself is not ignored.
  assert.equal(sameLink("https://b.example/listing.php?mls=1", "https://b.example/listing.php?mls=2"), false);
  assert.equal(sameLink("https://b.example/listing.php?mls=1&utm_medium=email", "https://b.example/listing.php?mls=1"), true);
  // A portal's share link carries parameters of its own making; the listing's number is in the path.
  assert.equal(sameLink("https://www.redfin.com/WA/Graham/13013-224th-St-E-98338/home/123", "https://www.redfin.com/WA/Graham/13013-224th-St-E-98338/home/123?600390594=copy_variant&utm_source=ios_share"), true);
  assert.equal(sameLink("https://www.redfin.com/WA/Graham/13013-224th-St-E-98338/home/123", "https://www.redfin.com/WA/Graham/13013-224th-St-E-98338/home/456"), false);
  assert.equal(sameLink("not a link", "not a link"), false);
  assert.equal(webLink("13013 224th St E Graham"), "");
  assert.equal(webLink(` ${X.url} `), X.url);

  assert.equal(sameAddress("13013 224th St E, Graham, WA 98338", "13013 224th St E Graham, WA 98338"), "same");
  assert.equal(sameAddress("1234 N 45th St, Seattle, WA 98103", "1234 North 45th Street, Seattle, WA 98103-1234"), "same");
  assert.equal(sameAddress("13013 224th St E, Graham, WA 98338", "9 Other Rd, Tacoma, WA 98402"), "different");
  assert.equal(sameAddress("123 Main St, Tacoma, WA 98402", "123 Main St, Tacoma, WA 98403"), "different");
  // Number and zip agree and the street is written two ways, or one of them is not an address: no telling.
  assert.equal(sameAddress("12 Mt Vernon Rd, Graham, WA 98338", "12 Mount Vernon Rd, Graham, WA 98338"), "unknown");
  assert.equal(sameAddress("13013 224th St E, Graham, WA 98338", undefined), "unknown");
  assert.equal(sameAddress("Graham, WA 98338", "13013 224th St E, Graham, WA 98338"), "unknown");
});

test("a page pasted on its own, then another house's link: the page is set aside with the photos and price it filled in", () => {
  const pasted = paste(empty(), X)!;
  assert.deepEqual([links(pasted), pasted.price, about(pasted)], [X.photos, "549000", "HOUSE X"]);
  const next = linkGiven(pasted, Y.url);
  assert.equal(next.read, null);
  assert.deepEqual([next.link, links(next), next.price], [Y.url, [], ""]);
  assert.match(next.notice ?? "", /different listing/);
  assert.equal(listingToSend(next), undefined);
});

test("a page pasted on its own, then its own link: the page stays and takes the link", () => {
  const next = linkGiven(paste(empty(), X)!, X.url);
  assert.equal(next.notice, null);
  assert.deepEqual([about(next), next.read?.url, next.read?.host, links(next)], ["HOUSE X", X.url, "zillow.com", X.photos]);
  assert.equal(listingToSend(next)?.url, X.url);
  // What travels with the request has no photo links of its own: only what is in the box is looked at.
  assert.deepEqual(listingToSend(next)?.photos, []);
});

test("a page pasted on its own, then a link that does not say which house it is: the page is set aside, and the form says why", () => {
  const next = linkGiven(paste(empty(), X)!, "https://www.example-brokerage.com/listing/8842");
  assert.equal(next.read, null);
  assert.deepEqual(links(next), []);
  assert.match(next.notice ?? "", /could not tell/);
  // Pasted again with the link in the form, it is that link's page.
  const again = paste(next, X)!;
  assert.equal(again.read?.url, "https://www.example-brokerage.com/listing/8842");
  assert.equal(linkGiven(again, again.link).read?.url, again.read?.url);
});

test("arriving from the button on one house, then pasting another house's page: the form starts over with that page, and the first house's link goes", () => {
  const arrived = fromButton(X);
  assert.deepEqual([arrived.link, links(arrived), arrived.price, arrived.read?.read?.via], [X.url, X.photos, "549000", "button"]);
  const next = paste(arrived, Y)!;
  assert.deepEqual([next.link, links(next), next.price, about(next)], ["", Y.photos, "310000", "HOUSE Y"]);
  assert.deepEqual([next.read?.url, next.read?.address], ["", "9 Other Rd, Tacoma, WA 98402"]);
  assert.match(next.notice ?? "", /different house/);
  const sent = listingToSend(linkGiven(next, next.link));
  assert.deepEqual([sent?.url, sent?.price, sent?.description?.text.slice(0, 7)], ["", 310_000, "HOUSE Y"]);
});

test("one link analysed through the browser, then another link: nothing of the first is left for the second", () => {
  const page = (h: typeof X) => `<html><head><title>${h.text.split("\n")[4]} | Example</title><meta property="og:description" content="${h.text.split("\n")[3]} ${h.text.split("\n")[5]}"></head><body>${h.html}${h.text.split("\n").map((l) => `<p>${l}</p>`).join("")}</body></html>`;
  const read = (h: typeof X) => ({ ...parseFetchedListing(h.url, page(h)), read: { at: NOW.toISOString(), via: "browser" as const } });
  const first = browserRead(linkGiven(empty(), X.url), read(X));
  assert.deepEqual([links(first), first.price, about(first)], [X.photos, "549000", "HOUSE X"]);
  // The second link: the form is as empty as if the first had never been, so the browser is asked for the second page.
  const second = linkGiven(first, Y.url);
  assert.deepEqual([second.read, links(second), second.price], [null, [], ""]);
  const done = browserRead(second, read(Y));
  assert.deepEqual([links(done), done.price, about(done), done.read?.url], [Y.photos, "310000", "HOUSE Y", Y.url]);
});

test("the same link with something added to it by hand is still the page that was pasted for it", () => {
  const pasted = paste(linkGiven(empty(), X.url), X)!;
  const next = linkGiven(pasted, `${X.url}?utm_source=share`);
  assert.equal(next.notice, null);
  assert.deepEqual([about(next), next.read?.sqft, links(next)], ["HOUSE X", 2340, X.photos]);
  // The reading keeps the link it was made with, which the server takes as the same page.
  assert.equal(sameLink(listingToSend(next)!.url, next.link), true);
});

test("a second paste of the same house joins the first: the gallery adds its photos, a fuller copy brings its description", () => {
  const text = paste(empty(), { text: X.text })!;
  assert.deepEqual([links(text), about(text)], [[], "HOUSE X"]);
  const gallery = paste(text, { html: X.html, text: "$549,000 4 bd 3 ba" })!;
  assert.equal(gallery.notice, null);
  assert.deepEqual([links(gallery), about(gallery), gallery.read?.address], [X.photos, "HOUSE X", "13013 224th St E, Graham, WA 98338"]);
  // The page copied again after "Show more": the longer description is the one kept.
  const more = X.text.replace("Seller has never occupied the property.", "Seller has never occupied the property. Roof replaced in 2019, furnace in 2021.");
  const fuller = paste(gallery, { text: more })!;
  assert.match(fuller.read?.description?.text ?? "", /furnace in 2021\.$/);
  assert.deepEqual(links(fuller), X.photos);
});

test("one house's page pasted after another's, with no link in the form: the form starts over with the second", () => {
  const next = paste(paste(empty(), X)!, Y)!;
  assert.deepEqual([links(next), next.price, about(next), next.read?.address], [Y.photos, "310000", "HOUSE Y", "9 Other Rd, Tacoma, WA 98402"]);
  assert.match(next.notice ?? "", /different house/);
});

test("a page pasted for a link, then read through the browser as well: the browser's reading fills the gaps and replaces nothing", () => {
  const pasted = paste(linkGiven(empty(), X.url), { text: X.text })!;
  // The browser got the page before its script had drawn it: one photo and "Loading…".
  const thin = { ...parseFetchedListing(X.url, `<html><head><title>Zillow</title></head><body><img src="${X.photos[0]}"><p>Loading…</p></body></html>`), read: { at: NOW.toISOString(), via: "browser" as const } };
  const next = browserRead(linkGiven(pasted, X.url), thin);
  assert.deepEqual([about(next), next.read?.sqft, links(next)], ["HOUSE X", 2340, [X.photos[0]]]);
  assert.deepEqual(next.read?.read, { at: NOW.toISOString(), via: "paste", with: ["browser"] });
});

test("something that is not a link in the link field is not the pasted page's link", () => {
  const typed = { ...empty(), link: "13013 224th St E Graham" };
  const pasted = paste(typed, X)!;
  assert.equal(pasted.read?.url, "");
  const cleared = linkGiven(pasted, "");
  assert.deepEqual([cleared.notice, about(cleared), listingToSend(cleared)?.url], [null, "HOUSE X", ""]);
});

test("the link in the form was changed and its page pasted: the reading of the old link is set aside, and the page is the new link's", () => {
  const arrived = fromButton(X);
  const next = paste({ ...arrived, link: Y.url }, Y)!;
  assert.deepEqual([next.link, links(next), next.price, about(next), next.read?.url], [Y.url, Y.photos, "310000", "HOUSE Y", Y.url]);
  assert.match(next.notice ?? "", /different listing/);
  assert.equal(linkGiven(next, Y.url).read?.url, Y.url);
});

test("a page pasted with another house's link in the form: the link is cleared, not the page", () => {
  const next = paste({ ...empty(), link: Y.url }, X)!;
  assert.deepEqual([next.link, next.read?.url, about(next)], ["", "", "HOUSE X"]);
  assert.match(next.notice ?? "", /link was cleared/);
});

test("moving to another house: the asking price goes with the first house, typed or not; the person's own photos stay, and the form says so", () => {
  const dropped = photoLinksAdded({ ...empty(), price: "500000" }, `https://cdn.example.com/mine.jpg\nnot a link`)!;
  assert.equal(photoLinksAdded(empty(), "no links here"), null);
  const pasted = paste(dropped, X)!;
  // On the same house a price the person typed is theirs: the page's price does not replace it.
  assert.deepEqual([links(pasted), pasted.price], [["https://cdn.example.com/mine.jpg", ...X.photos], "500000"]);
  const next = linkGiven(pasted, Y.url, 2);
  // Another house: its price is not this one's, whoever put it there. The photo the person dropped in and the two they uploaded stay, and are named.
  assert.deepEqual([links(next), next.price, next.read], [["https://cdn.example.com/mine.jpg"], "", null]);
  assert.match(next.notice ?? "", /different listing.*The 3 photos you added yourself are still in the form: take them out if they are the other house's\.$/);
  // An offer typed over one house's price, then another house's page: it runs at the new page's price, not at the offer.
  const offered = { ...paste(empty(), X)!, price: "500000" };
  const other = paste(offered, Y)!;
  assert.deepEqual([other.price, other.filled.price, about(other)], ["310000", "310000", "HOUSE Y"]);
});

test("a pasted link starts by itself only when everything in the form is that link's", () => {
  // Nothing in the form, or only what this link's own reading put there: it starts.
  assert.equal(linkPasted(empty(), X.url).start, true);
  const read = paste(linkGiven(empty(), X.url), X)!;
  assert.deepEqual([linkPasted(read, X.url).start, linkPasted(read, X.url).form.notice], [true, null]);
  // Gallery photos dragged in and a price typed, for whichever house: the form waits and says why.
  const mine = { ...photoLinksAdded(empty(), X.photos.join("\n"))!, price: "549000" };
  const held = linkPasted(mine, Y.url);
  assert.equal(held.start, false);
  assert.match(held.form.notice ?? "", /did not start by itself/);
  assert.deepEqual([held.form.link, links(held.form), held.form.price], [Y.url, X.photos, "549000"]);
  // The same for uploaded files, which the form cannot see into.
  assert.equal(linkPasted(empty(), Y.url, 1).start, false);
  // After an analysis of one link, another link: the price that was left is taken out, and then it can start.
  const ran = analysisStarted({ ...linkGiven(empty(), X.url), price: "549000" });
  const moved = linkPasted(ran, Y.url);
  assert.deepEqual([moved.start, moved.form.price], [true, ""]);
  assert.match(moved.form.notice ?? "", /different listing from the last one/);
  // The same link again keeps its price.
  assert.equal(linkGiven(ran, `${X.url}?utm_source=share`).price, "549000");
});

test("two houses whose addresses cannot be told apart are told apart by price, bedrooms and size", () => {
  // No address line on either page.
  const noAddress = (h: typeof X) => ({ html: h.html, text: h.text.split("\n").filter((line) => !/, [A-Z]{2} \d{5}$/.test(line)).join("\n") });
  const first = paste(empty(), noAddress(X))!;
  assert.equal(first.read?.address, undefined);
  const second = paste(first, noAddress(Y))!;
  assert.deepEqual([links(second), second.price, about(second)], [Y.photos, "310000", "HOUSE Y"]);
  assert.match(second.notice ?? "", /different house/);
  // A second piece of the same page agrees with the first on what it repeats, and joins it.
  const piece = paste(first, { html: `<div><img src="${photo("d")}"></div>`, text: "$549,000 4 bd 3 ba" })!;
  assert.deepEqual([links(piece), piece.notice, about(piece)], [[...X.photos, photo("d")], null, "HOUSE X"]);
});

test("addresses with a number in the street's name: the house's own page under its own link stays, and two houses on one road are two", () => {
  const page = (price: string, address: string, name: string, letter: string) => ({
    html: `<div><img src="${photo(letter)}"></div>`,
    text: ["Buy", "Rent", "Sell", "For sale", price, "3 bd 2 ba 1,620 sqft", address, "Built in 1978", "What's special", `HOUSE ${name}. Brick ranch on a deep lot. Original kitchen and baths, newer windows. Estate sale, sold as-is.`, "Facts & features", "Sewer: Public Sewer"].join("\n"),
  });
  const M = page("$389,000", "45200 12 Mile Rd, Novi, MI 48377", "M", "a");
  const N = page("$612,000", "47111 12 Mile Rd, Novi, MI 48377", "N", "d");
  const M_URL = "https://www.zillow.com/homedetails/45200-12-Mile-Rd-Novi-MI-48377/22_zpid/";
  const own = paste(linkGiven(empty(), M_URL), M)!;
  assert.deepEqual([own.link, own.notice, own.read?.address, own.read?.url], [M_URL, null, "45200 12 Mile Rd, Novi, MI 48377", M_URL]);
  // The page first, then its own link.
  const then = linkGiven(paste(empty(), M)!, M_URL);
  assert.deepEqual([then.notice, about(then), then.read?.url], [null, "HOUSE M", M_URL]);
  const other = paste(paste(empty(), M)!, N)!;
  assert.deepEqual([links(other), other.price, about(other)], [[photo("d")], "612000", "HOUSE N"]);
  // Utah's grid: "1234 E 4500 S".
  const U = page("$549,000", "1234 E 4500 S, Salt Lake City, UT 84117", "U", "b");
  const U_URL = "https://www.zillow.com/homedetails/1234-E-4500-S-Salt-Lake-City-UT-84117/11_zpid/";
  const utah = paste(linkGiven(empty(), U_URL), { html: U.html, text: `${U.text}\nNearby homes\n$615,000\n4 bd 3 ba 2,950 sqft\n4471 S Wander Ln, Salt Lake City, UT 84117` })!;
  assert.deepEqual([utah.link, utah.notice, utah.read?.address, utah.price], [U_URL, null, "1234 E 4500 S, Salt Lake City, UT 84117", "549000"]);
});

test("a link that does not say its address: what an answer said its house is, is remembered, and another house's page is not taken under it", () => {
  const BROKER = "https://www.windfall.example/listing/2301234";
  // The link was analysed (the server read it) and the answer named its house.
  const answered = houseLearned(analysisStarted(linkGiven(empty(), BROKER)), BROKER, "13013 224th St E, Graham, WA 98338");
  const next = paste(answered, Y)!;
  assert.deepEqual([next.link, next.read?.url, about(next), next.price], ["", "", "HOUSE Y", "310000"]);
  assert.match(next.notice ?? "", /link was cleared/);
  // That house's own page is taken under the link.
  const same = paste(answered, X)!;
  assert.deepEqual([same.link, same.read?.url, same.notice], [BROKER, BROKER, null]);
});

test("a paste with nothing of a listing in it is not a listing, and a reading belongs to the link it was made with", () => {
  assert.equal(paste(empty(), { text: "just some words that say nothing about any house at all, long enough to be looked at" }), null);
  const pasted = paste(linkGiven(empty(), X.url), X)!;
  assert.equal(readingIsFor(pasted.read!, X.url), "same");
  // The same house at another link is another listing page: its reading is not carried over.
  assert.equal(readingIsFor(pasted.read!, "https://www.redfin.com/WA/Graham/13013-224th-St-E-98338/home/12345"), "different");
  // With no link to belong to, it stays as it is.
  assert.equal(readingIsFor(pasted.read!, ""), "same");
  assert.equal(readingIsFor(pasted.read!, "13013 224th St E"), "same");
});
