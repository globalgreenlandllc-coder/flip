import { test } from "node:test";
import assert from "node:assert/strict";
import { BODIES, HOUSES, WAYS, faults, pages, previews, type Reader } from "./corpus-pages.mts";
import { parseFetchedListing, parseListingHtml, parsePastedListing } from "./fetch-listing.ts";
import { prefillFromParams } from "./prefill.ts";

/**
 * Generated listing pages with known answers.
 *
 * The reader's other tests are single pages, each written after something
 * went wrong on a page like it. That was not enough: a rule added for one
 * page quietly changed what was read on others (an asking price skipped for
 * a neighbour's, a similar home's bedrooms taken for the house's, the
 * house's own price box taken for another home's card). So this reads
 * ordinary pages built out of small parts in every combination
 * (corpus-pages.mts), every way a page arrives. The price, the beds, the
 * baths, the living area, the address and the year built each have to be the
 * house's own, or absent where the page does not state it. Never another
 * home's, and never missing where the page does state it. And what a page
 * says only of the homes it goes on to show (how long one has been listed)
 * is not read at all.
 *
 * The parts are written by hand in the way listing sites lay their pages
 * out. No site was read to make them, so this says nothing about how well
 * the reader does on real pages: only that it does not mix houses up, or
 * lose the house, on pages built like these.
 *
 * `npm test` reads a spread of about 6,800 of the pages. To read all 20.4
 * million (several hours in one process): FLIP_CORPUS=full npm test.
 * One house and one kind of page at a time, in twelve processes side by
 * side, it takes about half an hour:
 *   FLIP_CORPUS=full npx tsx --test --test-name-pattern="Graham.*plain" lib/listing/corpus.test.mts
 */
const EVERY = process.env.FLIP_CORPUS === "full" ? 1 : 3001;

const reader: Reader = {
  pasted: (text) => parsePastedListing("", text),
  button: (text) => prefillFromParams({ listing: "https://www.windfall.example/listing/2301234", text })!.listing,
  fetched: (url, html) => parseFetchedListing(url, html),
  server: (url, html) => parseListingHtml(url, html),
};

for (const [h, house] of HOUSES.entries())
  for (const [b, body] of BODIES.entries())
    test(`generated pages for ${house.address}, ${body} page: every field is the house's own`, () => {
      const preview = previews(house, body);
      const found: string[] = [];
      let read = 0;
      // A different spread for each house and kind of page.
      for (const page of pages(house, body, EVERY, ((h * BODIES.length + b) * 97) % EVERY)) {
        for (const [name, way] of Object.entries(WAYS)) {
          read++;
          for (const fault of faults(house, body, page, way, way.read(reader, page, preview))) {
            if (found.length < 12) found.push(`${name}: ${fault.field} ${fault.kind === "missing" ? "not read" : `read as ${JSON.stringify(fault.value)}`}  [${page.name}]`);
          }
        }
      }
      assert.ok(read >= 2_500, `only ${read} readings were made`);
      assert.deepEqual(found, []);
    });
