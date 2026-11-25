import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DESCRIPTION_CHARS, MAX_DETAILS, mergeFacts, pageText, readPage, readText, saneFact } from "./listing-facts.ts";
import { findAddress, findAddresses, parseFetchedListing, parseListingHtml, parseListingText, parsePastedListing } from "./fetch-listing.ts";
import { mergeListings, sourcesOf, subjectFromListing } from "./subject.ts";

/**
 * The pages below are written by hand in the way listing sites lay theirs
 * out. They are not captured pages: no listing site was read to make them.
 */
const REMARKS =
  "Sold as-is. Cash or rehab loan only: the septic system failed inspection in 2025 and the county requires a new drainfield.\nLarge shop, level acre, territorial view. Roof replaced 2019. Seller has never occupied the property.";

const PAGE = `<html><head><title>13013 224th St E, Graham, WA 98338 | MLS #2301234</title>
<meta property="og:title" content="13013 224th St E, Graham, WA 98338 | Example Homes" />
<meta property="og:description" content="For sale: $549,000. 4 bd, 3 ba, 2,340 sqft home built in 1987." />
<meta property="og:image" content="https://photos.example.com/p/1.jpg" />
<style>.x{content:"Sewer: Not A Fact"}</style>
<script id="__DATA__" type="application/json">{"home":{"yearBuilt":1987,"lotAreaValue":1.02,"lotAreaUnits":"Acres","livingArea":2340,"bedrooms":4,"bathrooms":3,"daysOnZillow":12,"homeType":"SINGLE_FAMILY","homeStatus":"FOR_SALE","monthlyHoaFee":null,"taxAnnualAmount":5432,"latitude":47.0512,"longitude":-122.2581,"description":${JSON.stringify(REMARKS)}}}</script>
</head><body>
<nav><a href="/">Home</a><a href="/buy">Buy</a></nav>
<div><h2>What&rsquo;s special</h2><p>${REMARKS.split("\n")[0]}</p><p>${REMARKS.split("\n")[1]}</p><button>Show more</button></div>
<h2>Facts &amp; features</h2>
<ul><li><span>Sewer: Septic Tank</span></li><li><span>Water source: Private Well</span></li><li>Roof: Composition</li><li>Heating: Forced Air, Heat Pump</li>
<li>Special listing conditions: Real Estate Owned</li><li>Listing terms: Cash, Rehab Loan</li><li>Parcel number: 0418171234</li><li>Favorite color: Blue</li></ul>
<dl><dt>Zoning</dt><dd>R10</dd><dt>Foundation</dt><dd>Poured Concrete</dd></dl>
<table><tr><th>Possession</th><td>Closing</td></tr></table>
<p>HOA dues: $35/mo</p><p>12 days on Zillow</p><p>Garage spaces: 2</p><p>Stories: 2</p>
<script>var tracking = "Sewer: From A Script";</script>
</body></html>`;

test("the page's visible text comes out one line per block, with hidden blocks gone and a label and its value on one line", () => {
  const text = pageText(PAGE);
  const lines = text.split("\n");
  assert.ok(lines.includes("What’s special"));
  assert.ok(lines.includes("Sewer: Septic Tank"));
  assert.ok(lines.includes("Zoning: R10"));
  assert.ok(lines.includes("Possession: Closing"));
  assert.ok(lines.includes("Facts & features"));
  assert.doesNotMatch(text, /Not A Fact|From A Script|tracking|lotAreaValue/);
});

test("a page gives up its description, its facts and its detail lines, each with where it was read", () => {
  const page = readPage({ html: PAGE });

  // The page ships its own data: believed first.
  assert.deepEqual(page.facts.yearBuilt, { value: 1987, source: "data" });
  assert.deepEqual(page.facts.lotSqft, { value: Math.round(1.02 * 43_560), source: "data" });
  assert.deepEqual(page.facts.sqft, { value: 2340, source: "data" });
  assert.deepEqual(page.facts.taxAnnual, { value: 5432, source: "data" });
  assert.deepEqual(page.facts.propertyType, { value: "single family", source: "data" });
  assert.deepEqual(page.facts.status, { value: "for sale", source: "data" });
  assert.deepEqual([page.facts.lat?.value, page.facts.lng?.value], [47.0512, -122.2581]);
  // "monthlyHoaFee": null says nothing; the text does, and its own words are kept beside the number.
  assert.deepEqual(page.facts.hoaMonthly, { value: 35, source: "text", seen: "HOA dues: $35/mo" });
  assert.deepEqual(page.facts.mlsId, { value: "2301234", source: "text", seen: "MLS #2301234" });
  assert.deepEqual(page.facts.garage, { value: 2, source: "text", seen: "Garage spaces: 2" });
  assert.deepEqual(page.facts.stories, { value: 2, source: "text", seen: "Stories: 2" });

  assert.deepEqual(page.details, [
    { label: "Sewer", value: "Septic Tank" },
    { label: "Water source", value: "Private Well" },
    { label: "Roof", value: "Composition" },
    { label: "Heating", value: "Forced Air, Heat Pump" },
    { label: "Special listing conditions", value: "Real Estate Owned" },
    { label: "Listing terms", value: "Cash, Rehab Loan" },
    { label: "Parcel number", value: "0418171234" },
    { label: "Zoning", value: "R10" },
    { label: "Foundation", value: "Poured Concrete" },
    { label: "Possession", value: "Closing" },
  ]);

  assert.deepEqual(page.description, { text: REMARKS, source: "data" });
});

test("a pasted page, which is text only, still gives up the description under its heading", () => {
  const pasted = readText(pageText(PAGE));
  assert.equal(pasted.description?.source, "text");
  assert.equal(pasted.description?.text, REMARKS);
  assert.equal(pasted.details.length, 10);
  assert.equal(pasted.facts.hoaMonthly?.value, 35);
});

test("with no heading to go by, the description is the first long paragraph of plain prose, and says it is a guess", () => {
  const prose = "Charming 1952 craftsman on a quiet street. Original fir floors under the carpet. The kitchen was last updated in the nineties and the roof is ten years old. Detached garage with alley access.";
  const text = ["Buy", "Rent", "Sell", "$640,000", "3 bd 2 ba 1,840 sqft", prose, "Listed by Example Realty", "Price history", "11/2/2026 Listed for sale $640,000", "Schools", "Nearby homes"].join("\n");
  assert.deepEqual(readText(text).description, { text: prose, source: "text", unsure: true });
  // A line of numbers and a short blurb are not a description, and neither is the small print, however long.
  assert.equal(readText(["a", "b", "c", "d", "1,840 sqft 3 bd 2 ba ".repeat(20), "Nice house."].join("\n")).description, undefined);
  const smallPrint = "The information being provided is for the consumer's personal, non-commercial use and may not be used for any other purpose. Listing data is deemed reliable but is not guaranteed accurate by the MLS. All rights reserved.";
  assert.deepEqual(readText([smallPrint + " " + smallPrint, ...text.split("\n")].join("\n")).description, { text: prose, source: "text", unsure: true });
});

test("a fact on a line of its own is read with its unit and its period", () => {
  const read = (s: string) => readText(s).facts;
  assert.equal(read("Built in 1987").yearBuilt?.value, 1987);
  assert.equal(read("Year built: 2004").yearBuilt?.value, 2004);
  assert.equal(read("Lot size: 6,000 sqft").lotSqft?.value, 6000);
  assert.equal(read("0.25 acres lot").lotSqft?.value, 10_890);
  assert.equal(read("Lot: 2.5 acres").lotSqft?.value, 108_900);
  assert.equal(read("HOA dues: $250/mo").hoaMonthly?.value, 250);
  assert.equal(read("HOA fees $1,200 per year").hoaMonthly?.value, 100);
  assert.equal(read("$300 quarterly HOA fee").hoaMonthly?.value, 100);
  assert.equal(read("Annual tax amount: $5,432").taxAnnual?.value, 5432);
  assert.equal(read("12 days on Redfin").daysOnMarket?.value, 12);
  assert.equal(read("Time on Realtor.com: 45 days").daysOnMarket?.value, 45);
  assert.equal(read("MLS#: NWM2301234").mlsId?.value, "NWM2301234");
  assert.equal(read("Property type: Single-family").propertyType?.value, "Single-family");
  assert.equal(read("Status: Pending").status?.value, "Pending");
  assert.equal(read("2-car attached garage").garage?.value, 2);
  // A source is always said, and so are the words it was read from.
  assert.deepEqual(read("Built in 1987").yearBuilt, { value: 1987, source: "text", seen: "Built in 1987" });
});

test("a misreading is dropped, not kept", () => {
  const read = (s: string) => readText(s).facts;
  assert.equal(read("Built in 2987").yearBuilt, undefined);
  assert.equal(read("Year built: 1492").yearBuilt, undefined);
  assert.equal(read("MLS listing provided by the broker").mlsId, undefined);
  assert.equal(read("Stories: 0").stories, undefined);
  assert.equal(saneFact("sqft", { value: 87_120, source: "text" }), null);
  assert.equal(saneFact("sqft", { value: "2000", source: "text" }), null);
  assert.equal(saneFact("yearBuilt", { value: 1987, source: "a hunch" }), null);
  assert.equal(saneFact("favoriteColor", { value: "blue", source: "text" }), null);
  assert.equal(saneFact("lat", { value: 91, source: "data" }), null);
  assert.deepEqual(saneFact("status", { value: `  ${"x".repeat(500)}  `, source: "text", seen: "y".repeat(500) }), { value: "x".repeat(160), source: "text", seen: "y".repeat(120) });
});

test("only labels worth keeping are kept, a label with its value on the next line is paired, and the list is capped", () => {
  // "Listing terms:" is followed by another pair, not by its value; "Zoning" by another label; the last "Sewer" by a stray letter.
  const text = ["Sewer", "Septic Tank", "Listing terms:", "Roof: Metal", "Favorite color: Blue", "Roof: Metal", "Possession:", "At closing", "Zoning", "Sewer", "x", "y"].join("\n");
  assert.deepEqual(readText(text).details, [
    { label: "Sewer", value: "Septic Tank" },
    { label: "Roof", value: "Metal" },
    { label: "Possession", value: "At closing" },
  ]);
  const many = Array.from({ length: 200 }, (_, i) => `Roof: Kind ${i}`).join("\n");
  assert.equal(readText(many).details.length, MAX_DETAILS);
});

test("a row of empty cells leaves nothing behind it, and a row of more than two cells is not a label and its value", () => {
  assert.equal(pageText("<table><tr><th>Sewer</th><td>Septic</td><td></td><td></td></tr><tr><td></td><td></td></tr><tr><td>a</td><td></td><td>b</td></tr><tr><td>Year built</td><td>1987</td><td>2004</td></tr></table>"), "Sewer: Septic\na | b\nYear built | 1987 | 2004");
  // A row copied out of a table arrives with tabs between its cells.
  const copied = readText(["x", "y", "z", "Sewer\tSeptic", "Year built\t1987", "Roof\tMetal\tComposition"].join("\n"));
  assert.deepEqual(copied.details, [{ label: "Sewer", value: "Septic" }]);
  assert.equal(copied.facts.yearBuilt?.value, 1987);
});

test("the first reading wins, key by key", () => {
  const merged = mergeFacts({ yearBuilt: { value: 1987, source: "data" } }, undefined, { yearBuilt: { value: 1990, source: "text" }, stories: { value: 2, source: "text" } });
  assert.deepEqual(merged, { yearBuilt: { value: 1987, source: "data" }, stories: { value: 2, source: "text" } });
});

test("a listing read by the server keeps what it found, and says where each of the five old facts came from", () => {
  const info = parseListingHtml("https://www.example.com/homes/13013-224th", PAGE);
  assert.equal(info.fetched, true);
  assert.equal(info.address, "13013 224th St E, Graham, WA 98338");
  assert.deepEqual([info.price, info.beds, info.baths, info.sqft], [549_000, 4, 3, 2340]);
  assert.deepEqual(info.description, { text: REMARKS, source: "data" });
  assert.equal(info.details?.length, 10);
  // The link preview said the price and, side by side, the rooms and the size: a preview written that way is the page's own summary of this house.
  assert.deepEqual(info.facts?.price, { value: 549_000, source: "meta" });
  assert.deepEqual(info.facts?.beds, { value: 4, source: "meta" });
  assert.deepEqual(info.facts?.address, { value: "13013 224th St E, Graham, WA 98338", source: "meta" });
  assert.deepEqual(info.facts?.yearBuilt, { value: 1987, source: "data" });
  assert.equal(info.read, undefined);
});

test("a page with only a link preview keeps that as its description, and reads the preview's facts as the preview's", () => {
  const html = `<html><head><meta property="og:title" content="1234 N 45th St, Seattle, WA 98103 | Example" />
    <meta property="og:description" content="$749,000 · 3 beds, 2 baths, 1,840 sqft. Charming craftsman built in 1952. MLS #2298765." /></head><body></body></html>`;
  const info = parseListingHtml("https://www.example.com/homes/1234", html);
  assert.equal(info.description?.source, "meta");
  assert.match(info.description?.text ?? "", /Charming craftsman built in 1952/);
  // A link preview is a sentence. What it seems to say is kept with its words and marked as loose.
  assert.deepEqual(info.facts?.yearBuilt, { value: 1952, source: "meta", seen: "Charming craftsman built in 1952", loose: true });
  // "MLS #2298765" says what it is wherever it stands.
  assert.deepEqual(info.facts?.mlsId, { value: "2298765", source: "meta", seen: "MLS #2298765" });
  assert.equal(info.details, undefined);
  // ...and never used for the house's numbers.
  assert.deepEqual(subjectFromListing(info), { sqft: 1840, beds: 3, baths: 2 });
});

test("a block page says nothing about the house", () => {
  const info = parseListingHtml("https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/1_zpid/", `<html><head><title>Access Denied</title></head><body>Please verify you are a human. px-captcha Sewer: Septic Tank</body></html>`);
  assert.equal(info.fetched, false);
  assert.equal(info.description, undefined);
  assert.equal(info.facts, undefined);
  assert.equal(info.details, undefined);
  // The link still says which house it is.
  assert.equal(info.address, "13013 224th St E, Graham, WA 98338");
});

test("a page the browser read is read in full", () => {
  const info = parseFetchedListing("https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/1_zpid/", PAGE);
  assert.equal(info.fetched, true);
  assert.deepEqual(info.description, { text: REMARKS, source: "data" });
  assert.equal(info.facts?.yearBuilt?.value, 1987);
  assert.equal(info.details?.[0].label, "Sewer");
  // A check page shown to the person's own browser is still not the listing.
  const check = parseFetchedListing("https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/1_zpid/", `<html><head><title>Access to this page has been denied</title></head><body>Press &amp; Hold to confirm you are a human. Our office: 500 Other St, Tacoma, WA 98402</body></html>`);
  assert.equal(check.fetched, false);
  assert.match(check.note ?? "", /check page/);
  assert.equal(check.address, "13013 224th St E, Graham, WA 98338");
  assert.equal(check.facts, undefined);
});

test("a pasted page keeps its description and details, and its link says where it is when its text does not", () => {
  const text = pageText(PAGE).split("\n").filter((l) => !/13013/.test(l)).join("\n");
  const info = parsePastedListing("", `$549,000\n4 bd 3 ba 2,340 sqft\n${text}`, "https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/1_zpid/");
  assert.equal(info.description?.text, REMARKS);
  assert.equal(info.details?.length, 10);
  assert.deepEqual(info.facts?.address, { value: "13013 224th St E, Graham, WA 98338", source: "link" });
  assert.deepEqual(info.facts?.price, { value: 549_000, source: "text" });
  assert.deepEqual([info.price, info.beds, info.baths, info.sqft], [549_000, 4, 3, 2340]);
});

test("the street number is the number that stands on its own, not the end of the price before it", () => {
  assert.equal(parseListingText("$549,000 13013 224th St E, Graham, WA 98338 4 bd 3 ba").address, "13013 224th St E, Graham, WA 98338");
  assert.equal(parseListingText("Listed at 549,000. 8208 243rd Street Ct E, Graham, WA 98338").address, "8208 243rd Street Ct E, Graham, WA 98338");
});

test("the house's numbers are taken from a listing only when they are sane, and each says where it came from", () => {
  const listing = parseListingHtml("https://www.example.com/homes/13013-224th", PAGE);
  const fromListing = subjectFromListing(listing);
  // The lot and the garage are read and shown (listing.facts has both) but are not the valuation's to use yet.
  assert.deepEqual(fromListing, { sqft: 2340, beds: 4, baths: 3, yearBuilt: 1987 });
  assert.deepEqual([listing.facts?.lotSqft?.value, listing.facts?.garage?.value], [44_431, 2]);
  assert.deepEqual(sourcesOf({ baths: 2.5 }, fromListing), { sqft: "listing", lotSqft: "record", beds: "listing", baths: "caller", yearBuilt: "listing", garage: "record" });
  assert.deepEqual(sourcesOf({}, {}), { sqft: "record", lotSqft: "record", beds: "record", baths: "record", yearBuilt: "record", garage: "record" });
  // A lot size mistaken for the living area, and a listing that says "0 bd".
  assert.deepEqual(subjectFromListing({ url: "", host: "", fetched: true, photos: [], sqft: 87_120, beds: 0, baths: 2 }), { baths: 2 });
  assert.deepEqual(subjectFromListing(null), {});
});

test("a listing read by the browser and again by the server: the browser's reading wins, the server fills the gaps", () => {
  const mine = { ...parsePastedListing("", `4 bd 3 ba 2,340 sqft\n${pageText(PAGE)}`), url: "", host: "", fetched: true, read: { at: "2026-11-24T20:00:00.000Z", via: "paste" as const } };
  const theirs = { url: "https://www.zillow.com/homedetails/x/1_zpid/", host: "zillow.com", fetched: true, photos: ["https://photos.example.com/p/1.jpg"], price: 555_000, beds: 9, facts: { yearBuilt: { value: 1990, source: "meta" as const }, taxAnnual: { value: 1, source: "meta" as const } }, readFrom: { host: "estately.com", url: "https://www.estately.com/x", reason: "because" }, read: { at: "2026-11-24T20:01:00.000Z", via: "server" as const } };
  const both = mergeListings(mine, theirs);
  assert.equal(both.url, theirs.url);
  assert.deepEqual(both.photos, theirs.photos);
  assert.equal(both.description?.text, REMARKS);
  // The browser's page said 4 bedrooms; the server's read said 9. The page did not say the price or the year; the server's read did.
  assert.equal(both.beds, 4);
  assert.equal(both.facts?.beds?.value, 4);
  assert.equal(both.price, 555_000);
  assert.equal(both.facts?.yearBuilt?.value, 1990);
  assert.equal(both.facts?.hoaMonthly?.value, 35);
  // Both ways it was read are said.
  assert.deepEqual(both.read, { at: "2026-11-24T20:00:00.000Z", via: "paste", with: ["server"] });
  assert.equal(both.readFrom?.host, "estately.com");
});

test("the new reading costs one pass too, whatever the page is built like", () => {
  const size = 2_000_000;
  const shapes: Record<string, string> = {
    "description strings that never close": `"description":"${"a".repeat(100)}`.repeat(Math.floor(size / 115)),
    "a description of escapes": `"description":"${"\\\\".repeat(size / 2)}`,
    "fact keys with no value": `"yearBuilt":`.repeat(size / 12),
    "unclosed style blocks": "<style>".repeat(size / 7),
    "tens of thousands of small closed blocks": "<style>a</style>".repeat(size / 16),
    "closed scripts and styles in turn": "<script>a</script>x<style>b</style>".repeat(Math.floor(size / 35)),
    "a block inside a block inside a block": "<svg><script><style>".repeat(Math.floor(size / 20)) + "</style></script></svg>".repeat(Math.floor(size / 23)),
    "a script that opens and never closes, many times": "<script>x".repeat(size / 9),
    "entities": "&#x1F3E0;&amp;&bogus;".repeat(size / 21),
    "thousands of label lines": Array.from({ length: 60_000 }, (_, i) => `<li>Roof: Kind ${i}</li>`).join(""),
    "one endless line of digits and spaces": `<p>${"1 lot 2 acres ".repeat(size / 14)}</p>`,
    "table cells without end": "<td>a</td>".repeat(size / 10),
    "a megabyte of empty cells, then one letter": "<td></td>".repeat(size / 9) + "x",
    "the same inside one paragraph": `<p>${" :".repeat(size / 2)}x</p>`,
  };
  for (const [name, html] of Object.entries(shapes)) {
    const started = process.hrtime.bigint();
    const page = readPage({ html });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 2_000, `${name}: ${Math.round(ms)} ms`);
    assert.ok((page.description?.text.length ?? 0) <= MAX_DESCRIPTION_CHARS, name);
    assert.ok(page.details.length <= MAX_DETAILS, name);
  }
  const started = process.hrtime.bigint();
  readText("Sewer: ".repeat(300_000));
  readText(Array.from({ length: 100_000 }, () => "What's special").join("\n"));
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2_000, "text shapes");
});

test("thirty more pages built to be slow, through every way a page is read", () => {
  const N = 1_000_000;
  const rep = (unit: string) => unit.repeat(Math.floor(N / unit.length));
  const pages: Record<string, string> = {
    "br storm": rep("<br>"),
    "colon lines": rep("<p> : </p>"),
    "label colon storms": rep("<li>Sewer:</li>"),
    "label then label": rep("<li>Sewer</li><li>Roof</li>"),
    "lot lot lot": `<p>${rep("lot ")}</p>`,
    "digits and commas": `<p>${rep("1,")} acres lot</p>`,
    "dollar storms": `<p>${rep("$1 ")}hoa</p>`,
    "mls storms": `<p>${rep("mls # ")}</p>`,
    "days on": `<p>${rep("1 days on ")}</p>`,
    "property type": `<p>${rep("property type: ")}</p>`,
    "built in": `<p>${rep("built in ")}</p>`,
    "sentences": `<p>${rep("A. ")}</p>`,
    "prose lines": rep(`<p>${"Word. ".repeat(40)}</p>`),
    "headings": rep("<p>Description</p><p>x</p>"),
    "json description storms": rep(`"description":"${"a".repeat(79)}",`),
    "json description long open": rep(`"description":"${"a".repeat(7000)}`),
    "json keys": rep('"yearBuilt":[1],"lotSize":[2],'),
    "escaped json": rep(`\\"description\\":\\"${"a".repeat(90)}\\",`),
    "entities": rep("&amp;"),
    "ampersands": rep("&"),
    "lt storms": rep("<"),
    "gt storms": rep(">"),
    "open tags": rep("<p "),
    "nested svg": rep("<svg>") + rep("</svg>"),
    "script close only": rep("</script>"),
    "title storm": rep("<title>1 a, b, WA 98338</title>"),
    "meta description big": `<meta property="og:description" content="${rep("built in 1987 mls #1234 ")}">`,
  };
  for (const [name, html] of Object.entries(pages)) {
    for (const [how, run] of [["readPage", () => readPage({ html })], ["parseListingHtml", () => parseListingHtml("https://example.com/x", html)], ["parseFetchedListing", () => parseFetchedListing("https://example.com/x", html)]] as const) {
      const started = process.hrtime.bigint();
      run();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 1_500, `${name} through ${how}: ${Math.round(ms)} ms`);
    }
  }
  const texts: Record<string, string> = {
    "lines of ' :'": Array.from({ length: 50_000 }, () => "a : : : : : : : : b").join("\n"),
    "one long line": rep("Sewer: x "),
    "one long line of ' :' and x": `${rep(" :")}x`,
    "address storms": rep("1 a "),
    "prices": rep("$549,000 "),
    "newlines": "\n".repeat(N),
    "label alone": rep("Sewer\n"),
    "pairs": rep("Roof: Metal\n"),
  };
  for (const [name, text] of Object.entries(texts)) {
    for (const [how, run] of [["readText", () => readText(text)], ["parsePastedListing", () => parsePastedListing("", text)], ["parseListingText", () => parseListingText(text)]] as const) {
      const started = process.hrtime.bigint();
      run();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 1_500, `${name} through ${how}: ${Math.round(ms)} ms`);
    }
  }
});

// ── What a second, independent review of this reader found, each as a test ──

const TOP = ["Buy", "Rent", "Sell", "$249,000", "123 Main St, Tacoma, WA 98402", "3 bd 2 ba 1,840 sqft"];
const SHOP = "Classic 1948 bungalow with original fir floors and a dry basement. Detached shop built in 2019 with 220 power. Sits on a 1/4 acre lot with room for a 4 car garage.";

test("a sentence is not a fact: what the remarks mention is not read as the house's", () => {
  const page = (facts: string[]) => [...TOP, ...facts, "Description", SHOP, "Facts & features", "Sewer: Public Sewer"].join("\n");
  // The page states the year and the lot on lines of their own: those are the house's. "Built in 2019" is the shop's.
  const stated = readText(page(["Year built: 1948", "Lot size: 5,200 sqft"]));
  assert.deepEqual(stated.facts.yearBuilt, { value: 1948, source: "text", seen: "Year built: 1948" });
  assert.deepEqual(stated.facts.lotSqft, { value: 5200, source: "text", seen: "Lot size: 5,200 sqft" });
  assert.equal(stated.facts.garage, undefined);
  // The page states neither: nothing is read out of the remarks, which are kept whole.
  const silent = readText(page([]));
  assert.deepEqual([silent.facts.yearBuilt, silent.facts.lotSqft, silent.facts.garage], [undefined, undefined, undefined]);
  assert.equal(silent.description?.text, SHOP);
});

test("text with no lines to go by gives loose readings, with their words, and they are never the house's numbers", () => {
  // What the button on a listing page hands over: the top of the page as one run of words.
  const run = `${TOP.join(" ")} ${SHOP} HOA fee: $1,200 annually`;
  const facts = readText(run).facts;
  assert.deepEqual(facts.yearBuilt, { value: 2019, source: "text", seen: "Detached shop built in 2019", loose: true });
  // A quarter of an acre, not 4 acres.
  assert.equal(facts.lotSqft?.value, 10_890);
  assert.equal(facts.lotSqft?.loose, true);
  assert.match(facts.lotSqft?.seen ?? "", /Sits on a 1\/4 acre lot$/);
  assert.equal(facts.hoaMonthly?.value, 100);
  assert.equal(facts.garage, undefined);
  const listing = { ...parsePastedListing("", run), url: "", host: "", fetched: true };
  assert.equal(listing.facts?.yearBuilt?.loose, true);
  assert.deepEqual(subjectFromListing(listing), { sqft: 1840, beds: 3, baths: 2 });
});

test("areas are read as listings write them: fractions, a leading dot, a unit or nothing", () => {
  const lot = (line: string) => readText(line).facts.lotSqft?.value;
  assert.equal(lot("3/4 acre lot"), 32_670);
  assert.equal(lot("0.25-acre lot"), 10_890);
  assert.equal(lot(".25 acres"), 10_890);
  assert.equal(lot("¼ acre lot"), 10_890);
  assert.equal(lot("2½ acres"), 108_900);
  assert.equal(lot("Lot Size 7,405 Sq. Ft."), 7405);
  assert.equal(lot("Lot size (acres): 1.02"), 44_431);
  assert.equal(lot("Acres: 5"), 217_800);
  assert.equal(readText("Sits on a 1/4 acre lot with mature trees.").facts.lotSqft?.value, 10_890);
  assert.equal(readText("Home on a .25 acre lot.").facts.lotSqft?.value, 10_890);
  // No unit, no reading: 7,405 square feet and 0.17 acres are one and the same lot.
  assert.equal(lot("Lot size: 7,405"), undefined);
  assert.equal(lot("Lot 7 Block 2"), undefined);
  // The living area on one line and a lot heading on the next are two lines, not a lot of 2,340.
  assert.equal(lot("2,340 sqft\nLot description: level"), undefined);
  // What could not be read as a number is still kept as written.
  assert.deepEqual(readText(["a", "b", "c", "d", "Lot size: 7,405", "HOA dues: $420"].join("\n")).details, [{ label: "Lot size", value: "7,405" }, { label: "HOA dues", value: "$420" }]);
});

test("dues and taxes are read with the period the page gives, and not at all without one", () => {
  const hoa = (text: string) => readText(text).facts.hoaMonthly?.value;
  assert.equal(hoa("HOA fee: $1,200 annually"), 100);
  assert.equal(hoa("HOA fee: $1,200 annually (paid monthly: $100)"), 100);
  assert.equal(hoa("HOA: $300/qtr"), 100);
  assert.equal(hoa("HOA fee: $450 semi-annually"), 75);
  assert.equal(hoa("HOA: $95 monthly"), 95);
  assert.equal(hoa("Monthly HOA fee: $95"), 95);
  assert.equal(hoa("$50/mo HOA"), 50);
  assert.equal(hoa("HOA: None"), 0);
  // A month's or a year's? The page did not say.
  assert.equal(hoa("HOA: $420"), undefined);
  assert.equal(hoa("HOA: $420 biannually"), undefined);
  assert.equal(hoa("$-- HOA"), undefined);
  // The "$232" on the line above is the price per foot, not the fee.
  assert.equal(hoa("$232\nHOA: None"), 0);

  const tax = (text: string) => readText(text).facts.taxAnnual?.value;
  assert.equal(tax("Annual tax amount: $5,432"), 5432);
  assert.equal(tax("Property tax: $5,432 (2025)"), 5432);
  assert.equal(tax("2025 taxes: $5,432"), 5432);
  assert.equal(tax("Taxes: $5,432/yr"), 5432);
  // A payment calculator's "Property taxes $452" is a month's.
  assert.equal(tax("Principal & interest $2,950\nProperty taxes $452\nHome insurance $191"), undefined);
  assert.equal(tax("Property taxes: $452/mo"), undefined);
  assert.equal(tax("Tax amount: $5,432"), undefined);
  // "removed" has "mo" in it and is not a month.
  assert.equal(tax("Property taxes: $5,432 (2025), exemption removed"), 5432);
});

test("days, stories, garage, status and the listing number are read only where the line says them", () => {
  const f = (text: string) => readText(text).facts;
  assert.equal(f("Time on Zillow\n2 hours").daysOnMarket?.value, 0);
  assert.equal(f("5 days on market").daysOnMarket?.value, 5);
  assert.equal(f("Days on market\n--").daysOnMarket, undefined);
  assert.equal(f("Floors: 3 bedrooms upstairs").stories, undefined);
  assert.equal(f("Levels: Two").stories?.value, 2);
  assert.equal(f("room for a 4 car garage").garage, undefined);
  assert.equal(f("Garage spaces: 0").garage?.value, 0);
  assert.equal(f("HOA status: Active").status, undefined);
  assert.equal(f("Status: Sold on 06/01/2019").status?.value, "Sold");
  assert.equal(f("MLS GRID as of 2025").mlsId, undefined);
  assert.equal(f("Source: MLS 4 U Realty").mlsId, undefined);
  assert.equal(f("Source: NWMLS, MLS#: 2301234").mlsId?.value, "2301234");
  assert.equal(f("Rebuilt in 2015").yearBuilt, undefined);
  assert.equal(f("Year built: 1987 (remodeled 2019)").yearBuilt?.value, 1987);
});

test("a label and its value are read whatever the page builds them from", () => {
  const rows: [string, string][] = [["Year built", "1987"], ["Lot size", "7,405 sqft"], ["HOA dues", "$35/mo"], ["Annual tax amount", "$5,432"], ["Garage spaces", "2"], ["Stories", "2"], ["Property type", "Single Family"], ["Status", "Active"], ["Days on market", "12"], ["MLS#", "2301234"], ["Sewer", "Septic Tank"]];
  const filler = "<p>a</p><p>b</p><p>c</p><p>d</p><p>e</p>";
  const layouts: Record<string, string> = {
    "<p>Label: value</p>": rows.map(([k, v]) => `<p>${k}: ${v}</p>`).join(""),
    "table cells": `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`,
    "definition list": `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`,
    "two blocks": rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join(""),
    "two spans": `<ul>${rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("")}</ul>`,
  };
  for (const [name, body] of Object.entries(layouts)) {
    const { facts, details } = readPage({ html: filler + body });
    assert.deepEqual(
      [facts.yearBuilt, facts.lotSqft, facts.hoaMonthly, facts.taxAnnual, facts.garage, facts.stories, facts.daysOnMarket, facts.mlsId, facts.propertyType, facts.status].map((fact) => fact?.value),
      [1987, 7405, 35, 5432, 2, 2, 12, "2301234", "Single Family", "Active"],
      name,
    );
    // Two spans with nothing between them read "Sewer Septic Tank", which is not told apart from a sentence.
    assert.deepEqual(details, name === "two spans" ? [] : [{ label: "Sewer", value: "Septic Tank" }], name);
  }
});

test("where a page puts a value over its label, the value over it is the one read; where there is no telling, none is", () => {
  const wanted = { year: 1987, lot: 7405, details: [{ label: "Year renovated", value: "2019" }, { label: "Sewer", value: "Septic Tank" }] };
  const got = (lines: string[]) => {
    const { facts, details } = readText(lines.join("\n"));
    return { year: facts.yearBuilt?.value, lot: facts.lotSqft?.value, details };
  };
  assert.deepEqual(got(["Home facts", "Year built", "1987", "Year renovated", "2019", "Lot size", "7,405 sqft", "Sewer", "Septic Tank", "x"]), wanted);
  assert.deepEqual(got(["Home facts", "1987", "Year built", "2019", "Year renovated", "7,405 sqft", "Lot size", "Septic Tank", "Sewer", "x"]), wanted);
  // A year over the label and a year under it, and nothing else on the page to say which way it is laid out.
  assert.equal(readText(["a", "b", "c", "1987", "Year built", "2019", "d", "e"].join("\n")).facts.yearBuilt, undefined);
  const summary = readText(["a", "b", "4", "beds", "3", "baths", "2,340", "sqft", "x", "y"].join("\n")).facts;
  assert.deepEqual([summary.beds?.value, summary.baths?.value, summary.sqft?.value], [4, 3, 2340]);
});

test("in a page's text the first statement of a fact is the house's; in its data, where nothing comes first, every mention has to agree", () => {
  // The page says its own house first: a later line that says otherwise is a card further down.
  const lines = [...TOP, "Year built: 1948", "Lot size: 5,200 sqft", "Compare", "Year built: 2021", "Lot size: 0.12 acres"];
  const { facts } = readText(lines.join("\n"));
  assert.deepEqual([facts.yearBuilt?.value, facts.lotSqft?.value], [1948, 5200]);
  // Under a heading over other homes they are not read at all.
  const under = [...TOP, "Similar homes", "$612,000", "3 bd 2 ba 1,480 sqft", "Year built: 2021"];
  assert.equal(readText(under.join("\n")).facts.yearBuilt, undefined);
  // The page's data has no first and no later: thirty mentions one way and one another are two houses.
  const data = `<script>${JSON.stringify({ homes: [...Array.from({ length: 30 }, () => ({ yearBuilt: 1948 })), { yearBuilt: 2021 }] })}</script>`;
  assert.equal(readPage({ html: data }).facts.yearBuilt, undefined);
  // ...and a page with more mentions of its facts than are looked at cannot be said to agree with itself.
  const endless = `<script>${JSON.stringify({ homes: Array.from({ length: 5_000 }, () => ({ yearBuilt: 1948 })) })}</script>`;
  assert.equal(readPage({ html: endless }).facts.yearBuilt, undefined);
});

const P1 = "Classic 1952 rambler on a level lot close to the park, with original fir floors under the carpet and a dry basement.";
const P2 = "Sold strictly as-is. Cash or hard money only: the roof and the septic both need replacing, and the tenant stays until March.";
const SCHOOLS = "GreatSchools ratings are based on test scores and additional metrics when available. Check with the applicable school district prior to making a decision based on these boundaries. School service boundaries are intended to be used as a reference only and may change from year to year.";

test("the description is everything under its heading: bullets, chips, a section word inside it, and the paragraph that matters", () => {
  const under = (lines: string[]) => readText(["Buy", "Rent", ...lines].join("\n")).description;
  // Three short lines in the middle used to end it, dropping the paragraph that says "as-is".
  assert.equal(under(["Description", P1, "New furnace 2021", "Fenced back yard", "Detached garage", P2, "Facts & features", "Sewer: Septic Tank"])?.text, [P1, "New furnace 2021", "Fenced back yard", "Detached garage", P2].join("\n"));
  assert.equal(under(["Overview", P1, "Interior", P2, "Facts & features"])?.text, [P1, "Interior", P2].join("\n"));
  assert.equal(under(["What's special", "FENCED YARD", "CORNER LOT", "NEW FURNACE", P2, "Show more", "Facts & features", "Sewer: Septic Tank", "Nearby schools", SCHOOLS])?.text, ["FENCED YARD", "CORNER LOT", "NEW FURNACE", P2].join("\n"));
  assert.equal(under(["Description", "Sold as-is.", "Cash only.", "Septic failed.", "Tenant occupied.", "Facts & features", "Nearby schools", SCHOOLS])?.text, "Sold as-is.\nCash only.\nSeptic failed.\nTenant occupied.");
  assert.equal(under(["Description: " + P2, "Facts & features"])?.text, P2);
  // A section word ends it when no prose follows, and so do two facts in a row and the page's furniture.
  assert.equal(under(["Description", P1, "Interior", "Bedrooms: 3", "Bathrooms: 2"])?.text, P1);
  assert.equal(under(["Description", P1, "Roof: Composition", "Heating: Forced Air", "Cooling: None"])?.text, P1);
  assert.equal(under(["Description", P1, "Share", "Save", "Hide", "Print", "Report", "Tour", "Apply", "Compare", "Notes", "More"])?.text, P1);
  // The words before the paragraph are part of what it says; a heading with nothing under it is not a description.
  assert.equal(under(["Overview", "Facts & features", "Description", P1, "Listed by Example Realty"])?.text, P1);
  // Who listed it ends the description by its form, not by its first words: this disclosure is a line of the remarks.
  assert.equal(under(["Description", P1, "Listing agent is related to the seller.", P2, "Listing provided by Example MLS", "Source: Example MLS #2301234"])?.text, [P1, "Listing agent is related to the seller.", P2].join("\n"));
  const long = under(["Description", ...Array.from({ length: 40 }, () => P1 + " " + P2)]);
  assert.equal(long?.cut, true);
  assert.ok((long?.text.length ?? 0) <= MAX_DESCRIPTION_CHARS && (long?.text.length ?? 0) > MAX_DESCRIPTION_CHARS - 10);
});

test("with no heading: remarks that end in the usual disclaimer are still remarks, and a school blurb or a cookie notice is not", () => {
  const reliable = "Classic 1952 rambler on a level lot, sold as-is. Cash or hard money only: the roof and the septic both need replacing. Tenant in place month to month. All information deemed reliable but not guaranteed, buyer to verify to their own satisfaction.";
  const cookies = "We use cookies and similar technologies to run this site, to measure how it is used and to show you advertising. You can change your choices at any time in the preference centre. Some of them are needed for the site to work.";
  const smallPrint = "Listing data is deemed reliable but is not guaranteed accurate by the MLS. The information being provided is for the consumer's personal, non-commercial use and may not be used for any other purpose. All rights reserved.";
  const found = readText(["a", "b", cookies, "c", "d", reliable, "Nearby schools", SCHOOLS + " " + SCHOOLS, smallPrint].join("\n")).description;
  assert.deepEqual(found, { text: reliable, source: "text", unsure: true });
  assert.equal(readText(["a", "b", "c", "d", cookies, SCHOOLS, smallPrint].join("\n")).description, undefined);
});

test("a string called \"description\" in the page's data is the listing's only when the page says so", () => {
  const remarks = `${P1} ${P2}`;
  const cookie = "We use cookies and similar technologies to run this site, to measure how it is used and to show you advertising that is relevant to you. You can change your choices at any time in the preference centre. Some of them are needed for the site to work and cannot be switched off in our systems. This goes on for longer than any listing's remarks do.";
  const bio = "Jane has sold homes in Pierce County for twenty years and answers her phone on weekends. Call her today to talk about your next move.";
  const json = (data: unknown) => `<script type="application/json">${JSON.stringify(data)}</script>`;
  const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  const filler = "<p>a</p><p>b</p><p>c</p><p>d</p>";

  // The page shows the remarks under their heading: the data's copy of the same words is the description, the longer strings are not.
  const shown = readPage({ html: `${json({ consent: { description: cookie }, agent: { description: bio }, property: { description: remarks } })}${filler}<h2>Description</h2><p>${remarks}</p><h2>Property details</h2>` });
  assert.deepEqual(shown.description, { text: remarks, source: "data" });
  // The page shows them cut short behind "Show more": the data has them whole.
  const clipped = readPage({ html: `${json({ property: { description: remarks } })}${filler}<h2>Description</h2><p>${P1}</p><button>Show more</button><h2>Property details</h2>` });
  assert.deepEqual(clipped.description, { text: remarks, source: "data" });
  // The page shows something else under its heading: what it shows is kept.
  assert.deepEqual(readPage({ html: `${json({ agent: { description: bio } })}${filler}<h2>Description</h2><p>${P1}</p><h2>Property details</h2>` }).description, { text: P1, source: "text" });

  // Nothing shown (the page is drawn by script). A node that is the house says so; its entities and markup are read.
  const typed = readPage({ html: ld([{ "@type": "RealEstateAgent", description: bio }, { "@type": ["Product", "SingleFamilyResidence"], description: "Wood floors &amp; new roof.<br>Seller&#39;s disclosure: sold as-is &mdash; cash only, the septic failed inspection in 2025." }]) });
  assert.deepEqual(typed.description, { text: "Wood floors & new roof.\nSeller's disclosure: sold as-is — cash only, the septic failed inspection in 2025.", source: "data" });
  // A field that only ever holds remarks.
  assert.equal(readPage({ html: json({ agent: { description: bio }, listing: { publicRemarks: remarks } }) }).description?.text, remarks);
  // Two strings called "description" and nothing to tell them apart: neither is guessed to be the listing's.
  assert.equal(readPage({ html: json({ agent: { description: bio }, other: { description: remarks } }) }).description, undefined);
  // Remarks longer than is kept are cut and say so, where they used to be skipped for a shorter string.
  const endless = readPage({ html: ld({ "@type": "RealEstateListing", description: "Long remarks. ".repeat(600) }) });
  assert.equal(endless.description?.cut, true);
  assert.equal(endless.description?.text.length, MAX_DESCRIPTION_CHARS);
});

test("a link preview's summary is kept as what it is, not as the listing's description", () => {
  const html = `<html><head><title>13013 224th St E, Graham, WA 98338 | Example</title>
    <meta property="og:description" content="Example has 37 photos of this $549,000 4 beds, 3 baths, 2,340 Square Feet single family home located at 13013 224th St E, Graham, WA 98338 built in 1987. Seller's own words are not here.">
    <meta property="og:image" content="https://photos.example.com/p/1.jpg"></head><body><div id="root"></div></body></html>`;
  const info = parseListingHtml("https://www.example.com/homes/13013", html);
  assert.equal(info.description?.source, "meta");
  // An apostrophe inside the tag's quotes used to end the summary there.
  assert.match(info.description?.text ?? "", /Seller's own words are not here\.$/);
  assert.deepEqual([info.price, info.beds, info.baths, info.sqft], [549_000, 4, 3, 2340]);
});

test("the page's own data: a fact is kept only when every mention of it on the page agrees", () => {
  const page = (data: unknown) => readPage({ html: `<script type="application/json">${JSON.stringify(data)}</script>` }).facts;
  const value = (facts: ReturnType<typeof page>) => Object.fromEntries(Object.entries(facts).map(([key, fact]) => [key, fact!.value]));
  // Another home's block before the subject's: first one found used to win.
  const two = page({ similarHomes: [{ yearBuilt: 2021, lotSize: 4000, bedrooms: 5, bathrooms: 4, livingArea: 3100, homeStatus: "SOLD" }], property: { yearBuilt: 1948, lotSize: 7405, bedrooms: 2, bathrooms: 1, livingArea: 850, homeStatus: "FOR_SALE", taxAnnualAmount: 5432 } });
  assert.deepEqual(value(two), { taxAnnual: 5432 });
  // The same fact said twice the same way is one fact.
  assert.deepEqual(value(page({ a: { yearBuilt: 1948, bedrooms: 2 }, b: { yearBuilt: "1948", bedrooms: 2 } })), { yearBuilt: 1948, beds: 2 });
  // Numbers written as text, with their separators and units.
  assert.deepEqual(value(page({ lotSize: "435,600 sqft", livingArea: "2,340", taxAnnualAmount: "5,432", bathrooms: 2.5 })), { lotSqft: 435_600, sqft: 2340, taxAnnual: 5432, baths: 2.5 });
  // A lot's number and the unit beside it; the unit is not borrowed from a neighbour.
  assert.deepEqual(value(page({ lotSize: 44_431, lotAreaValue: 1.02, lotAreaUnits: "Acres" })), { lotSqft: 44_431 });
  assert.deepEqual(value(page({ lotAreaUnits: "acres", lotAreaValue: 1.02 })), { lotSqft: 44_431 });
  assert.deepEqual(value(page({ lotAreaValue: 1.02, other: { lotAreaUnits: "Acres" } })), {});
  assert.deepEqual(value(page({ lotSize: 871, x: { lotAreaUnits: "Acres" } })), { lotSqft: 871 });
  // Data kept inside a string, as the big portals ship it.
  const inside = readPage({ html: `<script>window.__data = ${JSON.stringify({ cache: JSON.stringify({ property: { yearBuilt: 1987, homeType: "SINGLE_FAMILY", homeStatus: "FOR_SALE", daysOnZillow: 12 } }) })}</script>` }).facts;
  assert.deepEqual(value(inside), { yearBuilt: 1987, daysOnMarket: 12, propertyType: "single family", status: "for sale" });
});

test("an 850 sqft house is 850 sqft, a million-dollar price is a price, and beds, baths and size are read from one place", () => {
  assert.deepEqual(parseListingText("2 bd 1 ba 850 sqft"), { price: undefined, beds: 2, baths: 1, sqft: 850, address: undefined });
  // The page shows the lot too, and a similar home further down: neither is this house's living area.
  const small = parseListingText(["$249,000", "2 bd 1 ba 850 sqft", "123 Main St, Tacoma, WA 98402", "7,405 sqft lot", "Similar homes", "$615,000", "4 bd 3 ba 2,950 sqft", "9 Other Rd, Tacoma, WA 98402"].join("\n"));
  assert.deepEqual(small, { price: 249_000, beds: 2, baths: 1, sqft: 850, address: "123 Main St, Tacoma, WA 98402" });
  // The size is missing from this house's line: it is not taken from the next house's.
  assert.equal(parseListingText("$249,000 2 bd 1 ba -- sqft 123 Main St, Tacoma, WA 98402 " + "x ".repeat(100) + "Similar homes $615,000 4 bd 3 ba 2,950 sqft").sqft, undefined);
  assert.equal(parseListingText("12,500 sqft lot 3 bd 2 ba 1,200 sqft").sqft, 1200);
  // Two neighbouring spans copied without the space between them.
  assert.deepEqual([parseListingText("4 bd3 ba2,340 sqft").beds, parseListingText("4 bd3 ba2,340 sqft").baths, parseListingText("4 bd3 ba2,340 sqft").sqft], [4, 3, 2340]);

  const price = (text: string) => parseListingText(text).price;
  assert.equal(price("$1,250,000 4 bd 3 ba 2,900 sqft Est. $7,900/mo Nearby homes $849,000"), 1_250_000);
  assert.equal(price("$95,000 2 bd 1 ba 850 sqft Tax assessed value $112,400"), 95_000);
  assert.equal(price("Zestimate $561,200 Listed for $549,000"), 549_000);
  assert.equal(price("$561,200 Zestimate $549,000 4 bd 3 ba"), 549_000);
  assert.equal(price("$549,000 Price cut: $10,000 (11/2)"), 549_000);
  assert.equal(price("Sold for $655,000 on 06/01/21"), undefined);
  assert.equal(price("PRICE REDUCED! $549,000 4 bd 3 ba"), 549_000);
  assert.equal(price("Reduced by $10,000 Now $549,000"), 549_000);
  const preview = (summary: string) => parseListingHtml("https://e.example/x", `<meta property="og:description" content="${summary}"><meta property="og:image" content="https://e.example/photo/1.jpg">`).price;
  assert.equal(preview("$1,250,000 · 4 beds, 3 baths, 2,900 sqft"), 1_250_000);
  assert.equal(preview("Listed for $95,000. 2 bd 1 ba"), 95_000);
});

test("the street number is the last number standing on its own before the street's name", () => {
  const tail = ", Tacoma, WA 98402";
  for (const before of ["2 bd 1 ba 850 sqft ", "Built in 1987 ", "Listed 3 days ago ", "0.25 acres ", "Est. $3,600/mo ", "1 of 37\n", "MLS #2301234 ", "$249,000 "]) assert.equal(findAddress(`${before}123 Main St${tail}`), `123 Main St${tail}`, before);
  assert.equal(findAddress("4 bd 3 ba 2340 sqft 13013 224th St E, Graham, WA 98338"), "13013 224th St E, Graham, WA 98338");
  assert.equal(findAddress("123 Main St, Unit 4, Tacoma, WA 98402"), "123 Main St, Unit 4, Tacoma, WA 98402");
  assert.equal(findAddress("see 123 Main St Apt 4 Tacoma, WA 98402"), "123 Main St Apt 4 Tacoma, WA 98402");
  // A unit, a route and a county road are numbers too, and are not the house's.
  assert.equal(findAddress("3 bd 12345 State Route 7 E, Graham, WA 98338"), "12345 State Route 7 E, Graham, WA 98338");
  assert.equal(findAddress("4567 Highway 99, Lynnwood, WA 98087"), "4567 Highway 99, Lynnwood, WA 98087");
  assert.equal(findAddress("1234 Road 22 NE, Moses Lake, WA 98837"), "1234 Road 22 NE, Moses Lake, WA 98837");
  // The street and the city in two neighbouring spans, with no comma between them.
  assert.equal(findAddress("$549,000 13013 224th St E Graham, WA 98338"), "13013 224th St E Graham, WA 98338");
  assert.equal(findAddress("PO Box 123, Graham, WA 98338"), undefined);
  assert.equal(findAddress("Graham, WA 98338"), undefined);
  assert.equal(findAddress("call 253 555 0100, ZZ 98338"), undefined);
});

test("a robots tag does not make a listing a block page", () => {
  const remarks = `${P1} ${P2}`;
  const html = `<html><head><title>13013 224th St E, Graham, WA 98338 | Example Homes</title><meta name="robots" content="index, follow">
    <meta property="og:description" content="For sale: $549,000. 4 bd, 3 ba, 2,340 sqft."></head>
    <body><h2>Description</h2><p>${remarks}</p><ul><li>Sewer: Septic Tank</li><li>Listing terms: Cash</li></ul></body></html>`;
  const info = parseListingHtml("https://www.example-brokerage.com/homes/13013", html);
  assert.equal(info.fetched, true);
  assert.equal(info.note, undefined);
  assert.equal(info.description?.text, remarks);
  assert.equal(info.details?.length, 2);
  // A page with no photos and nothing of a listing that says what check pages say is one.
  for (const body of ["Press &amp; Hold to confirm you are a human (and not a bot).", "<div id='px-captcha'></div>", "Pardon Our Interruption"]) {
    assert.equal(parseListingHtml("https://www.zillow.com/homedetails/1_zpid/", `<html><head><title>Zillow</title></head><body>${body}</body></html>`).fetched, false, body);
  }
  // The same words deep in a long listing page are just words.
  const long = `<html><head><title>Listing</title></head><body>${"<p>A long page about a house.</p>".repeat(200)}<p>Security check at the gate.</p></body></html>`;
  assert.equal(parseListingHtml("https://e.example/x", long).fetched, true);
});

test("tags inside a line leave a space, commented-out markup is not read, and a dotted capital I moves nothing", () => {
  assert.equal(pageText("<div><span><b>4</b>bd</span><span><b>3</b>ba</span><span><b>2,340</b>sqft</span></div><h1><span>13013 224th St E</span><span>Graham, WA 98338</span></h1>"), "4 bd 3 ba 2,340 sqft\n13013 224th St E Graham, WA 98338");
  const html = `<p>a</p><p>b</p><p>c</p><p>d</p><!-- old: <li>Sewer: Public Sewer</li><li>Year built: 2020</li> --><ul><li>Sewer: Septic Tank</li><li>Year built: 1948</li></ul><select><option>Roof: Any</option></select>`;
  const page = readPage({ html });
  assert.equal(page.facts.yearBuilt?.value, 1948);
  assert.deepEqual(page.details, [{ label: "Sewer", value: "Septic Tank" }]);
  const dotted = `<p>${"İ".repeat(30)}stanbul Realty</p><script>var a = "Sewer: From A Script"; var b = "Year built: 1901";</script><p>Year built: 1987</p><p>a</p><p>b</p><p>c</p><p>d</p>`;
  assert.doesNotMatch(pageText(dotted), /From A Script|1901/);
  assert.equal(readPage({ html: dotted }).facts.yearBuilt?.value, 1987);
});

test("a label that is also the name of something every object has is just a label", () => {
  for (const label of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    const page = readText(["a", "b", "c", "d", `${label}: x`, label, "y"].join("\n"));
    assert.deepEqual([page.details, page.facts], [[], {}], label);
  }
});

test("pages the second review built to be slow", () => {
  const N = 2_000_000;
  const rep = (unit: string) => unit.repeat(Math.floor(N / unit.length));
  const pages: Record<string, string> = {
    // One <meta that never closes, with the wanted attribute over and over: six minutes at 4 MB before tags were scanned.
    "one unclosed meta, og:title again and again": "<meta " + rep(`name="og:title" `),
    "the same with every key": "<meta " + rep(`name="og:title" name="og:description" name="description" name="og:image" name="twitter:image" `),
    "unclosed metas each with a key": rep(`<meta name="og:title" `),
    "a megabyte of cells in one row": `<table><tr>${rep("<td></td>")}<td>x</td></tr></table>`,
    "label rows in turn": rep("<tr><td>Year built</td><td>1987</td><td>Lot size</td><td>1 acre</td></tr>"),
    "comments that never close": rep("<!-- a "),
    "comments opened and closed": rep("<!-- a -->b"),
    "quotes that never close in tags": rep(`<img src="a `),
    "img tags with long srcsets": rep(`<img srcset="${"a 1x,".repeat(200)}">`),
    "json prices": rep(`"price":123456,`),
    "json facts that disagree": rep(`"yearBuilt":1987,"yearBuilt":1988,`),
    "lot values with units": rep(`"lotAreaValue":1.5,"lotAreaUnits":"Acres",`),
    "description candidates shown on the page": `<p>${"Word. ".repeat(30)}</p>` + rep(`"description":"${"Word. ".repeat(30)}",`),
    "typed JSON-LD, deep": `<script type="application/ld+json">${'{"a":'.repeat(20_000)}1${"}".repeat(20_000)}</script>`,
    "addresses without numbers": `<p>${rep("Main St, Tacoma, WA 98402 ")}</p>`,
    "address tails": rep("<p>a, WA 98402</p>"),
    "beds without baths": `<p>${rep("4 bd ")}</p>`,
    "label lines alone": rep("<p>Year built</p>"),
    "values and labels in turn": rep("<p>1987</p><p>Year built</p>"),
  };
  for (const [name, html] of Object.entries(pages)) {
    for (const [how, run] of [["parseListingHtml", () => parseListingHtml("https://example.com/x", html)], ["parseFetchedListing", () => parseFetchedListing("https://example.com/x", html)], ["parsePastedListing", () => parsePastedListing(html, "")]] as const) {
      const started = process.hrtime.bigint();
      run();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 1_500, `${name} through ${how}: ${Math.round(ms)} ms`);
    }
  }
  // Text typed or pasted into the browser, where a slow pattern freezes the tab: 49 seconds for these digits before.
  const texts: Record<string, string> = {
    "two hundred thousand digits": "1".repeat(200_000),
    "digits and spaces": rep("1 "),
    "dollars": rep("$1,000,000 "),
    "comma tails": rep(", WA 98402 "),
    "numbers before a tail": `${rep("1 ").slice(0, 150_000)} Main St, Tacoma, WA 98402`,
    "one cell row with tabs": rep("a\t"),
    "fractions": rep("1/4 acre lot "),
  };
  for (const [name, text] of Object.entries(texts)) {
    for (const [how, run] of [["parseListingText", () => parseListingText(text)], ["parsePastedListing", () => parsePastedListing("", text)], ["readText", () => readText(text)]] as const) {
      const started = process.hrtime.bigint();
      run();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 1_500, `${name} through ${how}: ${Math.round(ms)} ms`);
    }
  }
});

// ── What a third review, of the rewrite itself, found ──────────────────────

const NEARBY = ["Similar homes", "$612,000", "4 bd 3 ba 2,610 sqft", "9102 198th St E, Graham, WA 98338"];
const HOUSE = ["4 bd 3 ba 2,340 sqft", "13013 224th St E, Graham, WA 98338", "What's special", "Updated rambler on a quiet street."];

test("the words a page puts beside its asking price do not make the reader take a neighbour's", () => {
  const price = (lines: string[]) => parsePastedListing("", [...lines, ...HOUSE, ...NEARBY].join("\n")).price;
  // Buttons and badges above the price, and what stands under it.
  for (const above of [["Share", "Save"], ["Hide", "More"], ["Price drop"], ["Price cut"], ["Priced from"], ["Great value"], ["Est."], ["Reduced"], ["New price"], ["Just dropped"]]) assert.equal(price([...above, "$549,000"]), 549_000, above.join(" / "));
  for (const under of ["Save", "More details", "Estimated payment $3,456/mo", "Estimate your payment", "Est. payment: $3,456/mo", "Price cut: $10K (11/3)", "Price cut $10K", "Price drop", "Down payment assistance available", "Offer review date 11/30", "Less than renting", "Below list by 2%"])
    assert.equal(price(["For sale", "$549,000", under]), 549_000, under);
  // What says an amount is other money says it on that amount's own line.
  assert.equal(price(["Zestimate®: $561,200", "$549,000"]), 549_000);
  assert.equal(price(["$549,000", "$561,200 Zestimate®"]), 549_000);
  assert.equal(price(["Was $575,000", "$549,000"]), 549_000);
  assert.equal(price(["$549,000", "Price cut: $10,000 (11/3)"]), 549_000);
  // The amount beside the beds and baths is something else: there is no asking price to read, and the nearby home's is not it.
  assert.equal(price(["Sold for $549,000"]), undefined);
  assert.equal(price(["Zestimate®: $561,200"]), undefined);
  assert.equal(price(["For sale"]), undefined);
});

test("a price followed by a comma is a price, in a sentence and in the page's data", () => {
  for (const text of ["13013 224th St E, Graham, WA 98338 is a 4 bed, 3 bath, 2,340 sqft house listed at $549,000, built in 1987.", "4 bd, 3 ba home for $549,000, on a quiet street.", "For sale: $549,000, 4 bd, 3 ba", "Offered at $549,000; 4 bd, 3 ba"]) assert.equal(parseListingText(text).price, 549_000, text);
  const page = (json: string) => parseListingHtml("https://www.example-realty.com/homes/2301234", `<html><head><title>13013 224th St E, Graham, WA 98338 | Example Realty</title><meta property="og:image" content="https://photos.example-realty.com/1.jpg"><script type="application/json">${json}</script></head><body></body></html>`).price;
  assert.equal(page(`{"listing":{"listPrice":549000,"bedrooms":4}}`), 549_000);
  assert.equal(page(`{"listing":{"price":549000,"currency":"USD"}}`), 549_000);
  assert.equal(page(JSON.stringify({ cache: JSON.stringify({ property: { price: 549000, bedrooms: 4 } }) })), 549_000);
  assert.equal(page(`{"listing":{"price":"549,000","bedrooms":4}}`), 549_000);
  // The house's price and a similar home's under the same key: two prices, and no telling which is ours.
  assert.equal(page(`{"listing":{"price":549000,"bedrooms":4},"similar":[{"price":525000}]}`), undefined);
});

test("a link preview's sentence does not set the house's bedrooms, bathrooms or size", () => {
  const page = (remarks: string, facts: boolean) => `<html><head><title>8208 243rd Street Ct E, Graham, WA 98338 | Windfall Realty</title>
    <meta property="og:description" content="${remarks}"><meta property="og:image" content="https://cdn.windfall.example/photos/1.jpg">
    ${facts ? `<script type="application/json">{"listing":{"bedrooms":4,"bathrooms":2.5,"livingArea":2340}}</script>` : ""}</head><body>
    <h1>8208 243rd Street Ct E, Graham, WA 98338</h1><div>$449,000</div>${facts ? "<ul><li>Bedrooms: 4</li><li>Bathrooms: 2.5</li><li>Living Area: 2,340 sqft</li></ul>" : ""}
    <h2>Description</h2><p>${remarks}</p></body></html>`;
  const read = (remarks: string, facts = true) => {
    const info = parseListingHtml("https://www.windfall.example/listing/2301234", page(remarks, facts));
    return [info.beds, info.baths, info.sqft];
  };
  const shop = "Rare find on a shy half acre! This 4 bedroom rambler comes with a 1,200 sqft detached shop with 220 power, RV parking and a fully fenced yard.";
  const adu = "Investor special. Main house needs work; the detached 1 bedroom ADU with 1 bath and 480 sqft is rented month to month. Bring your contractor.";
  const cottage = "Two homes on one lot! The 2 bedroom, 1 bath cottage at the back is 720 sqft and was built in 2019. The main house has original hardwoods.";
  const lot = "Sits on a 10,890 sq ft corner lot. This 4 bedroom home has a new roof, new furnace and fresh paint inside and out.";
  // What the page states is believed, whatever its remarks open with.
  for (const remarks of [shop, adu, cottage, lot]) assert.deepEqual(read(remarks), [4, 2.5, 2340], remarks.slice(0, 30));
  // And with nothing stated, a sentence is still not read: not the shop's size, not the ADU's rooms, not the cottage's.
  for (const remarks of [shop, adu, cottage, lot]) assert.deepEqual(read(remarks, false), [undefined, undefined, undefined], remarks.slice(0, 30));
  // A preview that says the three side by side, and no other size, is the house's own summary.
  assert.deepEqual(read("For sale: $449,000. 4 bd, 3 ba, 2,340 sqft home on a quiet street.", false), [4, 3, 2340]);
  assert.deepEqual(read("Example has 37 photos of this $449,000 4 beds, 3 baths, 2,340 Square Feet single family home with a 7,405 sqft lot.", false), [4, 3, 2340]);
});

test("beds, baths and size are read side by side, each number with its own unit on its own line", () => {
  const read = (text: string) => {
    const page = parsePastedListing("", text);
    return [page.beds, page.baths, page.sqft];
  };
  // A page that writes the label first: "4" belongs to "Beds:", not to the "Baths" on the next line, and the lot is not the living area.
  const labels = ["Windfall Realty", "$449,000", "8208 243rd Street Ct E, Graham, WA 98338", "Beds: 4", "Baths: 3", "Sq Ft: 2,340", "Lot Size: 7,405 Sq Ft", "Year Built: 1987", "Description", "Well kept two story on a quiet cul-de-sac. New roof in 2021 and a fenced back yard."];
  assert.deepEqual(read(labels.join("\n")), [4, 3, 2340]);
  // The same handed over by the button as one run of words.
  assert.deepEqual(read(labels.join(" ")), [4, 3, 2340]);
  // Other ways the headline is written.
  assert.deepEqual(read(["$449,000", "4 BR | 3 BA | 2,340 SF | Built 1987", "x", "y", "Similar listings", "$389,000", "3 bd 2 ba 1,480 sqft"].join("\n")), [4, 3, 2340]);
  assert.deepEqual(read("2,340 sqft · 4 bd · 3 ba"), [4, 3, 2340]);
  assert.deepEqual(read("4 beds, 2.5 baths and 2,340 square feet"), [4, 2.5, 2340]);
  assert.deepEqual(read("Studio\n1 ba 480 sqft"), [undefined, 1, 480]);
  // Numbers over their labels, with a similar home's line further down: the page's own are read, not the first "bd ba sqft" in its text.
  const over = ["For sale", "$549,000", "13013 224th St E, Graham, WA 98338", "4", "beds", "3", "baths", "2,340", "sqft", "What's special", "Updated rambler on a quiet street.", "Bedrooms: 4", "Bathrooms: 3", "Nearby homes", "$615,000", "4 bd 3 ba 2,950 sqft", "9102 198th St E, Graham, WA 98338"];
  assert.deepEqual(read(over.join("\n")), [4, 3, 2340]);
  const whole = parsePastedListing("", over.join("\n"));
  assert.deepEqual([whole.price, whole.address], [549_000, "13013 224th St E, Graham, WA 98338"]);
  // A sentence is not a headline.
  assert.deepEqual(read("This 4 bedroom rambler comes with a 1,200 sqft detached shop and 2 baths."), [undefined, undefined, undefined]);
});

test("what follows \"Similar homes\" is other houses: their price, rooms and address are not this one's", () => {
  // The house's own lines say less than the neighbour's do.
  const page = parsePastedListing("", ["Buy", "Rent", "For sale", "$549,000", "Lot 5, Rural Route, Graham", "What's special", "Updated rambler on a quiet street.", "Similar homes", "$612,000", "4 bd 3 ba 2,610 sqft", "9102 198th St E, Graham, WA 98338"].join("\n"));
  assert.deepEqual([page.price, page.beds, page.sqft, page.address], [549_000, undefined, undefined, undefined]);
  // The same words in the page's menu, before anything about the house, are not that turn.
  const menu = parsePastedListing("", ["Overview", "Nearby homes", "Schools", "For sale", "$549,000", "4 bd 3 ba 2,340 sqft", "13013 224th St E, Graham, WA 98338", "x"].join("\n"));
  assert.deepEqual([menu.price, menu.beds, menu.address], [549_000, 4, "13013 224th St E, Graham, WA 98338"]);
});

test("the house number is the first number of the address, also where the street's name has a number of its own", () => {
  for (const address of [
    "1234 E 4500 S, Salt Lake City, UT 84117", "250 N 300 W, Provo, UT 84601", "5500 N 300 W, Marion, IN 46952", "45200 12 Mile Rd, Novi, MI 48377", "3301 17 Mile Dr, Pebble Beach, CA 93953",
    "1500 3 Notch Rd, Lexington Park, MD 20653", "52100 Avenue 52, Coachella, CA 92236", "123-45 67th Ave, Flushing, NY 11367", "N1234 County Rd A, Wautoma, WI 54982", "123 1/2 Main St, Tacoma, WA 98402",
  ]) {
    assert.equal(findAddress(address), address, address);
    // On a line of a page, and as the page's title.
    assert.equal(findAddress(`For sale\n$549,000\n4 bd 3 ba 2,340 sqft\n${address}\nBuilt in 1987`), address, address);
    assert.equal(parseListingHtml("https://example.com/l/1", `<html><head><title>${address} | MLS #1234567 | Example</title><meta property="og:image" content="https://cdn.example.com/photos/1.jpg"></head><body></body></html>`).address, address, address);
  }
  // After other text on the line, a number of the street's is still not mistaken for the house's, nor a stray number for either.
  assert.equal(findAddress("4 bd 3 ba 2,340 sqft 1234 E 4500 S, Salt Lake City, UT 84117"), "1234 E 4500 S, Salt Lake City, UT 84117");
  assert.equal(findAddress("Built in 1987 45200 12 Mile Rd, Novi, MI 48377"), "45200 12 Mile Rd, Novi, MI 48377");
  assert.equal(findAddress("Built in 1987 123 Main St, Tacoma, WA 98402"), "123 Main St, Tacoma, WA 98402");
  assert.equal(findAddress("9 Other Rd, Tacoma, WA 98402 123 Main St, Tacoma, WA 98402"), "9 Other Rd, Tacoma, WA 98402");
  assert.deepEqual(findAddresses("9 Other Rd, Tacoma, WA 98402 123 Main St, Tacoma, WA 98402"), ["9 Other Rd, Tacoma, WA 98402", "123 Main St, Tacoma, WA 98402"]);
});

test("a street on the line above its city is read with it, and nothing else on that line is", () => {
  assert.equal(findAddress("13013 224th St E\nGraham, WA 98338"), "13013 224th St E, Graham, WA 98338");
  assert.equal(findAddress("13013 224th St E,\nGraham, WA 98338"), "13013 224th St E, Graham, WA 98338");
  // Copied text often has an empty line between the two.
  assert.equal(findAddress("$549,000\n13013 224th St E\n\nGraham, WA 98338\n4 bd 3 ba 2,340 sqft"), "13013 224th St E, Graham, WA 98338");
  for (const street of ["712 Day Lily Ln", "1234 E 4500 S", "45200 12 Mile Rd", "123 Main St Apt 4", "123 Main St, Unit 4", "4567 Highway 99 N", "N1234 County Road X", "86-15 Broadway", "123 Avenue C", "8208 243rd Street Ct E"]) {
    assert.equal(findAddress(`${street}\nGraham, WA 98338`), `${street}, Graham, WA 98338`, street);
  }
  // The line over a city can be anything, and a number on it is not a house number.
  for (const above of ["Built in 1987", "1 of 37", "3 days on Zillow", "4 bd 3 ba 2,340 sqft", "2,340 sqft", "24 Homes", "$549,000", "MLS# 2301234", "4 Bedroom Home in Maple Glen", "Lot 12 Sunrise Estates", "Frederickson"]) {
    assert.equal(findAddress(`${above}\nGraham, WA 98338`), undefined, above);
  }
});

test("a page pasted for a link is that link's house when it says so anywhere, not only in the first address on it", () => {
  const link = "https://www.zillow.com/homedetails/1234-E-4500-S-Salt-Lake-City-UT-84117/11_zpid/";
  const text = ["For sale", "$549,000", "4 bd 3 ba 2,340 sqft", "1234 E 4500 S, Salt Lake City, UT 84117", "Built in 1987", "What's special", "Updated rambler in Holladay.", "Nearby homes", "$615,000", "4 bd 3 ba 2,950 sqft", "4471 S Wander Ln, Salt Lake City, UT 84117"];
  assert.deepEqual(parsePastedListing("", text.join("\n"), link).facts?.address, { value: "1234 E 4500 S, Salt Lake City, UT 84117", source: "text" });
  // An agent's office first, the house's own address after it.
  const office = ["Windfall Realty, 500 Other St, Tacoma, WA 98402", ...text];
  assert.equal(parsePastedListing("", office.join("\n"), link).address, "1234 E 4500 S, Salt Lake City, UT 84117");
  // ...and with no link to go by, it is still the address that stands with the price and the rooms, not the one under a brokerage's name.
  assert.equal(parsePastedListing("", office.join("\n")).address, "1234 E 4500 S, Salt Lake City, UT 84117");
  // Its address line written a way no reader gets, but the number and the zip are on it: still the link's house, by the link's words.
  const odd = text.map((line) => (line.startsWith("1234 E") ? "1234 E 4500 S · Salt Lake City · UT · 84117" : line));
  assert.equal(parsePastedListing("", odd.join("\n"), link).facts?.address?.source, "link");
  // Another house's page under this link keeps its own address, so the form can tell.
  assert.equal(parsePastedListing("", ["$310,000", "2 bd 1 ba 850 sqft", "9 Other Rd, Tacoma, WA 98402", "x", "y"].join("\n"), link).address, "9 Other Rd, Tacoma, WA 98402");
});

test("the description is under the heading that has prose under it, not under the first heading on the page", () => {
  const remarks = "Well kept two story on a quiet cul-de-sac. Sold as-is: the septic system failed inspection in 2025 and the county requires a new drainfield. Cash or rehab loan only.";
  const page = ["Windfall Realty", "$449,000", "8208 243rd Street Ct E, Graham, WA 98338", "Overview", "4 Beds", "3 Baths", "2,340 Sq Ft", "$192 per Sq Ft", "Built in 1987", "12 Days on Site", "About This Home", remarks, "Property Details", "Sewer: Septic Tank"];
  assert.deepEqual(parsePastedListing("", page.join("\n")).description, { text: remarks, source: "text" });
  // A block of figures under a heading is not a description even when it is the only heading there is.
  assert.equal(readText(page.slice(0, 10).join("\n")).description, undefined);
});
