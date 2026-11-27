import { test } from "node:test";
import assert from "node:assert/strict";
import { prefillFromParams } from "./prefill.ts";
import { formFromPrefill } from "./form.ts";

const AT = new Date("2026-11-26T18:00:00.000Z");

test("a home handed over by the deal finder fills the form with its address, price, size and rooms, and says where they came from", () => {
  const p = prefillFromParams({ from: "finder", address: "4821  Orchard Loop Rd, Fixture Falls, WA 98000", price: "250000", beds: "3", baths: "2", sqft: "1800" }, AT)!;
  assert.ok(p);
  assert.deepEqual([p.address, p.price, p.beds, p.baths, p.sqft, p.listingUrl, p.photos], ["4821 Orchard Loop Rd, Fixture Falls, WA 98000", 250_000, 3, 2, 1_800, undefined, []]);
  assert.deepEqual(p.listing.read, { at: AT.toISOString(), via: "finder" });
  assert.deepEqual(Object.keys(p.listing.facts ?? {}).sort(), ["address", "baths", "beds", "price", "sqft"]);
  // The form: no link, the asking price in its box, the photos the person's to add.
  const form = formFromPrefill(p);
  assert.deepEqual([form.link, form.price, form.read?.address, form.read?.read?.via], ["", "250000", "4821 Orchard Loop Rd, Fixture Falls, WA 98000", "finder"]);
});

test("what the finder hands over is held to what a listing may say; without an address and a price it is nothing", () => {
  assert.equal(prefillFromParams({ from: "finder", price: "250000" }, AT), null);
  assert.equal(prefillFromParams({ from: "finder", address: "4821 Orchard Loop Rd, Fixture Falls, WA 98000" }, AT), null);
  assert.equal(prefillFromParams({ from: "finder", address: "4821 Orchard Loop Rd, Fixture Falls, WA 98000", price: "-5" }, AT), null);
  const odd = prefillFromParams({ from: "finder", address: "4821 Orchard Loop Rd, Fixture Falls, WA 98000", price: "250000", beds: "300", sqft: "abc" }, AT)!;
  assert.deepEqual([odd.beds, odd.sqft], [undefined, undefined]);
  // A link or photos in the query are not taken from the finder's hand-over: it has neither.
  const more = prefillFromParams({ from: "finder", address: "4821 Orchard Loop Rd, Fixture Falls, WA 98000", price: "250000", listing: "https://www.zillow.com/homedetails/1_zpid/", photos: "https://photos.example/1.jpg" }, AT)!;
  assert.deepEqual([more.listingUrl, more.photos, more.listing.url], [undefined, [], ""]);
});
