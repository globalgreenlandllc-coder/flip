import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFromUrl, dedupePhotos, findAddresses, parseListingHtml, parseListingText, parsePastedListing } from "./fetch-listing.ts";

test("parses Open Graph metadata from a listing page", () => {
  const html = `<html><head>
    <title>1234 N 45th St, Seattle, WA 98103 | MLS #123 | Example</title>
    <meta property="og:title" content="1234 N 45th St, Seattle, WA 98103 | Example Homes" />
    <meta property="og:description" content="$749,000 &middot; 3 beds, 2 baths, 1,840 sqft. Charming craftsman." />
    <meta property="og:image" content="https://cdn.example.com/photo-1.jpg" />
    <meta property="og:image" content="https://cdn.example.com/photo-2.jpg" />
    <meta name="twitter:image" content="https://cdn.example.com/photo-1.jpg" />
  </head><body></body></html>`;
  const info = parseListingHtml("https://www.example.com/homes/1234", html);
  assert.equal(info.host, "example.com");
  assert.equal(info.fetched, true);
  assert.equal(info.address, "1234 N 45th St, Seattle, WA 98103");
  assert.equal(info.price, 749_000);
  assert.equal(info.beds, 3);
  assert.equal(info.baths, 2);
  assert.equal(info.sqft, 1840);
  assert.deepEqual(info.photos, ["https://cdn.example.com/photo-1.jpg", "https://cdn.example.com/photo-2.jpg"]);
});

test("reports a block page instead of pretending it read the listing", () => {
  const html = `<html><head><title>Access Denied</title></head><body>Please verify you are a human. px-captcha</body></html>`;
  const info = parseListingHtml("https://www.zillow.com/homedetails/x", html);
  assert.equal(info.fetched, false);
  assert.match(info.note ?? "", /blocked/);
  assert.equal(info.photos.length, 0);
});

test("extracts gallery photos from meta tags, JSON-LD and img tags, skipping logos and maps", () => {
  const html = `<html><head>
    <meta property="og:image" content="https://cdn.example.com/p/cover.jpg" />
    <script type="application/ld+json">{"@type":"SingleFamilyResidence","image":["https://cdn.example.com/p/1.jpg","https://cdn.example.com/p/2.jpg"],"photo":{"url":"https://cdn.example.com/p/3.jpg"}}</script>
  </head><body>
    <img src="/static/logo.png">
    <img src="https://maps.example.com/staticmap.png">
    <img src="https://cdn.example.com/p/cover.jpg">
    <img data-src="https://cdn.example.com/p/4.webp" srcset="https://cdn.example.com/p/4-320.webp 320w, https://cdn.example.com/p/4-1280.webp 1280w">
    <picture><source srcset="//cdn.example.com/p/5.jpg 1x, //cdn.example.com/p/5@2x.jpg 2x"></picture>
    <img src="/photos/6.jpg">
    <img src="data:image/gif;base64,R0lGOD">
  </body></html>`;
  const photos = parseListingHtml("https://www.example.com/homes/1", html).photos;
  assert.deepEqual(photos, [
    "https://cdn.example.com/p/cover.jpg",
    "https://cdn.example.com/p/1.jpg",
    "https://cdn.example.com/p/2.jpg",
    "https://cdn.example.com/p/3.jpg",
    "https://cdn.example.com/p/4-1280.webp",
    "https://cdn.example.com/p/5@2x.jpg",
    "https://www.example.com/photos/6.jpg",
  ]);
});

test("dedupes CDN size variants and keeps the largest jpg", () => {
  const urls = [
    "https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_1536.jpg",
    "https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-uncropped_scaled_within_1536_1152.webp",
    "https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-uncropped_scaled_within_1344_1008.jpg",
    "https://photos.zillowstatic.com/fp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-d_d.webp",
    "https://photos.zillowstatic.com/fp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-d_d.jpg",
    "https://cdn.example.com/photos/kitchen-320w.jpg",
    "https://cdn.example.com/photos/kitchen-1280w.jpg",
  ];
  assert.deepEqual(dedupePhotos(urls), [
    "https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_1536.jpg",
    "https://photos.zillowstatic.com/fp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-d_d.jpg",
    "https://cdn.example.com/photos/kitchen-1280w.jpg",
  ]);
});

test("falls back to the page's embedded JSON for the price", () => {
  const html = `<html><head><meta property="og:title" content="13013 224th Street E, Graham, WA 98338 | Zillow" />
    <meta property="og:description" content="4 beds, 3 baths, 2,072 sqft house" /></head>
    <body><script>window.__data = {"hdpData":{"homeInfo":{"price":599950,"listPrice":599950}}}</script></body></html>`;
  const info = parseListingHtml("https://www.zillow.com/homedetails/x/1_zpid/", html);
  assert.equal(info.price, 599_950);
  assert.equal(info.sqft, 2072);
  assert.equal(info.address, "13013 224th Street E, Graham, WA 98338");
});

test("reads the address out of portal URLs", () => {
  assert.equal(addressFromUrl("https://www.zillow.com/homedetails/13013-224th-St-E-Graham-WA-98338/49182454_zpid/"), "13013 224th St E, Graham, WA 98338");
  assert.equal(addressFromUrl("https://www.redfin.com/WA/Graham/13013-224th-St-E-98338/home/12345"), "13013 224th St E, Graham, WA 98338");
  assert.equal(addressFromUrl("https://www.realtor.com/realestateandhomes-detail/13013-224th-St-E_Graham_WA_98338_M12345-67890"), "13013 224th St E, Graham, WA 98338");
  assert.equal(addressFromUrl("https://example.com/listing/1"), undefined);
});

test("a Zillow link's city is not cut in half where the city is known to be of several words", () => {
  const zillow = (slug: string) => addressFromUrl(`https://www.zillow.com/homedetails/${slug}/49182454_zpid/`);
  // Washington's cities of two and three words, the kind King and Pierce County are full of.
  assert.equal(zillow("1500-S-336th-St-Federal-Way-WA-98003"), "1500 S 336th St, Federal Way, WA 98003");
  assert.equal(zillow("4120-Rosedale-St-NW-Gig-Harbor-WA-98335"), "4120 Rosedale St NW, Gig Harbor, WA 98335");
  assert.equal(zillow("7813-44th-St-W-University-Place-WA-98466"), "7813 44th St W, University Place, WA 98466");
  assert.equal(zillow("21620-Pacific-Hwy-S-Des-Moines-WA-98198"), "21620 Pacific Hwy S, Des Moines, WA 98198");
  assert.equal(zillow("17425-Ballinger-Way-NE-Lake-Forest-Park-WA-98155"), "17425 Ballinger Way NE, Lake Forest Park, WA 98155");
  assert.equal(zillow("450-Main-Ave-S-North-Bend-WA-98045"), "450 Main Ave S, North Bend, WA 98045");
  assert.equal(zillow("3009-Lake-Rd-Lake-Stevens-WA-98258"), "3009 Lake Rd, Lake Stevens, WA 98258");
  assert.equal(zillow("22404-Mill-Creek-Blvd-Mill-Creek-WA-98012"), "22404 Mill Creek Blvd, Mill Creek, WA 98012");
  assert.equal(zillow("610-Alder-St-Unit-B-Mercer-Island-WA-98040"), "610 Alder St Unit B, Mercer Island, WA 98040");
  assert.equal(zillow("9116-State-Route-9-Lake-Stevens-WA-98258"), "9116 State Route 9, Lake Stevens, WA 98258");
  assert.equal(zillow("301-W-1st-St-South-Cle-Elum-WA-98943"), "301 W 1st St, South Cle Elum, WA 98943");
  // The street keeps its number and at least a word of its name: "Mill Creek" here is the street.
  assert.equal(zillow("15-Mill-Creek-WA-98012"), "15 Mill, Creek, WA 98012");

  // Everywhere else the city is the last word, exactly as it was. Guessing by the kinds of words
  // (a direction or "St" ends a street) broke each of these in review: streets are named E, S Meridian, Trail Ridge.
  assert.equal(zillow("8208-243rd-Street-Ct-E-Graham-WA-98338"), "8208 243rd Street Ct E, Graham, WA 98338");
  assert.equal(zillow("800-5th-Ave-APT-12B-Seattle-WA-98104"), "800 5th Ave APT 12B, Seattle, WA 98104");
  assert.equal(zillow("1215-E-St-Bellingham-WA-98225"), "1215 E St, Bellingham, WA 98225");
  assert.equal(zillow("1234-E-E-St-Tacoma-WA-98404"), "1234 E E St, Tacoma, WA 98404");
  assert.equal(zillow("3912-S-Meridian-Puyallup-WA-98373"), "3912 S Meridian, Puyallup, WA 98373");
  assert.equal(zillow("3900-NW-Esplanade-Seattle-WA-98117"), "3900 NW Esplanade, Seattle, WA 98117");
  assert.equal(zillow("77-S-Washington-Sq-Seattle-WA-98104"), "77 S Washington Sq, Seattle, WA 98104");
  assert.equal(zillow("104-Trail-Ridge-Pass-Austin-TX-78738"), "104 Trail Ridge Pass, Austin, TX 78738");
  assert.equal(zillow("77-Broadway-Seattle-WA-98102"), "77 Broadway, Seattle, WA 98102");
  assert.equal(zillow("12-Avenue-C-Brooklyn-NY-11218"), "12 Avenue C, Brooklyn, NY 11218");
  assert.equal(zillow("500-N-St-Paul-St-Dallas-TX-75201"), "500 N St Paul St, Dallas, TX 75201");
  // Outside Washington a city of several words is still cut at its last word, as it always was: a known limit.
  assert.equal(zillow("300-Broadway-New-York-NY-10007"), "300 Broadway New, York, NY 10007");
  assert.equal(zillow("123-Main-St-St-Louis-MO-63101"), "123 Main St St, Louis, MO 63101");
  // Not an address.
  assert.equal(zillow("Seattle-WA-98102"), undefined);
  assert.equal(zillow("123-Main-St-Unit-4-WA-98102"), undefined);
});

test("parses a copied listing page: photos from the HTML, facts from the text", () => {
  const html = `<div><h1>8208 243rd Street Ct E, Graham, WA 98338</h1><span>$589,000</span>
    <img src="https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_960.jpg" srcset="https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_1536.jpg 1536w">
    <img src="https://photos.zillowstatic.com/fp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-uncropped_scaled_within_1536_1152.jpg">
    <img src="https://www.zillowstatic.com/s3/pfs/static/logo.svg"></div>`;
  const text = "8208 243rd Street Ct E, Graham, WA 98338 $589,000 3 beds 2 baths 1,650 sqft Est. payment $3,800/mo";
  const info = parsePastedListing(html, text, "https://www.zillow.com/homedetails/8208-243rd-Street-Ct-E-Graham-WA-98338/1_zpid/");
  assert.equal(info.address, "8208 243rd Street Ct E, Graham, WA 98338");
  assert.equal(info.price, 589_000);
  assert.equal(info.beds, 3);
  assert.equal(info.baths, 2);
  assert.equal(info.sqft, 1650);
  assert.deepEqual(info.photos, [
    "https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_1536.jpg",
    "https://photos.zillowstatic.com/fp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-uncropped_scaled_within_1536_1152.jpg",
  ]);
});

test("parseListingText ignores monthly payment figures when picking the price", () => {
  const f = parseListingText("Est. payment $3,800/mo. Listed at $749,950. 4 bd 3 ba 2,072 sqft");
  assert.equal(f.price, 749_950);
  assert.equal(f.beds, 4);
  assert.equal(f.baths, 3);
  assert.equal(f.sqft, 2072);
});

test("prefill from the bookmark query string", async () => {
  const { prefillFromParams } = await import("./prefill.ts");
  const p = prefillFromParams({
    listing: "https://www.zillow.com/homedetails/8208-243rd-Street-Ct-E-Graham-WA-98338/1_zpid/",
    photos: "https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_960.jpg,https://photos.zillowstatic.com/fp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cc_ft_1536.jpg,https://photos.zillowstatic.com/fp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-d_d.jpg",
    text: "8208 243rd Street Ct E, Graham, WA 98338 $589,000 3 beds 2 baths 1,650 sqft",
  });
  assert.ok(p);
  assert.equal(p!.photos.length, 2);
  assert.equal(p!.price, 589_000);
  assert.equal(p!.beds, 3);
  assert.equal(p!.sqft, 1650);
  assert.equal(p!.address, "8208 243rd Street Ct E, Graham, WA 98338");
  assert.equal(prefillFromParams({}), null);
});

test("dedupe prefers the larger variant even when the hash contains digits", () => {
  const out = dedupePhotos([
    "https://photos.zillowstatic.com/fp/042ded27b1d67494392badddd357a07e-cc_ft_960.jpg",
    "https://photos.zillowstatic.com/fp/042ded27b1d67494392badddd357a07e-cc_ft_1536.jpg",
  ]);
  assert.deepEqual(out, ["https://photos.zillowstatic.com/fp/042ded27b1d67494392badddd357a07e-cc_ft_1536.jpg"]);
});

test("movoto: one photo per id, largest variant, site chrome dropped, JSON-LD price wins", () => {
  const html = `<html><head><meta property="og:image" content="https://pi.movoto.com/p/501/2573452_0_u3BNIr_p.webp" />
    <script type="application/ld+json">[{"@type":"Product","image":"https://pi.movoto.com/p/501/2573452_0_u3BNIr_p.webp","offers":{"@type":"Offer","price":699000}}]</script>
    <meta property="og:description" content="Previously sold for $655,000. 4 bd 3 ba 2,000 sqft" /></head><body>
    <img src="https://www.movoto.com/novaimgs/vimages/movoto-lower-small.png">
    <img src="https://pi.movoto.com/p/501/2573452_0_u3BNIr_t.jpeg">
    <img src="https://pi.movoto.com/p/501/2573452_0_u3BNIr_l.webp">
    <img src="https://pi.movoto.com/p/501/2573452_1_AbCdEf_r.webp">
    <img src="https://pi.movoto.com/p/501/2573452_1_AbCdEf_p.webp"></body></html>`;
  const info = parseListingHtml("https://www.movoto.com/graham-wa/8208-243rd-st-ct-e-graham-wa-98338-501_1051609/", html);
  assert.equal(info.price, 699_000);
  assert.deepEqual(info.photos, [
    "https://pi.movoto.com/p/501/2573452_0_u3BNIr_l.webp",
    "https://pi.movoto.com/p/501/2573452_1_AbCdEf_r.webp",
  ]);
});

test("estately: address slugs and photo variants", async () => {
  const { estatelyCandidates } = await import("./resolve.ts");
  const c = estatelyCandidates("8208 243rd Street Ct E, Graham, WA 98338");
  assert.equal(c[0], "https://www.estately.com/listings/info/8208-243rd-street-ct-e-graham-wa-98338");
  assert.ok(c.includes("https://www.estately.com/listings/info/8208-243rd-st-ct-e-graham-wa-98338"));
  assert.deepEqual(estatelyCandidates("no zip here"), []);
  const photos = dedupePhotos([
    "https://images.estately.net/139_NWM2573452_0_1788304049_100x74.jpg",
    "https://images.estately.net/139_NWM2573452_0_1788304049_320x212a.jpg",
    "https://images.estately.net/139_NWM2573452_0_1788304049.jpg",
    "https://images.estately.net/139_NWM2573452_0_1788304049_636x435.jpg",
    "https://images.estately.net/139_NWM2573452_1_1788304050_636x435.jpg",
  ]);
  assert.deepEqual(photos, [
    "https://images.estately.net/139_NWM2573452_0_1788304049.jpg",
    "https://images.estately.net/139_NWM2573452_1_1788304050_636x435.jpg",
  ]);
});

test("a page built to be slow to read is read in one pass", () => {
  // Each of these took seconds per 100 KB before the patterns stopped crossing tag boundaries
  // (and minutes at this size). A hostile site can serve any of them behind a pasted link.
  const size = 2_000_000;
  const shapes: Record<string, string> = {
    "unclosed <meta": "<meta ".repeat(size / 6),
    "unclosed <img": "<img ".repeat(size / 5),
    "unclosed <title": "<title ".repeat(size / 7),
    "unclosed JSON-LD scripts": `<script type="application/ld+json">`.repeat(Math.floor(size / 35)),
    "one endless tag": "<meta " + "a=1 ".repeat(size / 4),
    "thousands of different photos": "<html><body>" + Array.from({ length: 30_000 }, (_, i) => `<img src="https://c.example/photo/${i}.jpg">`).join("") + "</body></html>",
    "a title with digits and no commas": `<title>${"1 a ".repeat(size / 4)}</title>`,
  };
  for (const [name, html] of Object.entries(shapes)) {
    const started = process.hrtime.bigint();
    const info = parseListingHtml("https://example.com/listing", html);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 1_500, `${name}: ${Math.round(ms)} ms`);
    assert.ok(info.photos.length <= 16, name);
  }
  // The same for text copied off a page.
  const started = process.hrtime.bigint();
  parseListingText("1 a ".repeat(500_000));
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 1_500, "long text with digits and no commas");
});

test("JSON-LD is still read when the page is well-formed, upper-case tags and all", () => {
  const html = `<html><head>
    <SCRIPT TYPE="application/ld+json">{"@type":"Product","image":["https://photos.example.com/a.jpg","https://photos.example.com/b.jpg"],"offers":{"price":512000}}</SCRIPT>
    <script>var notJson = 1;</script>
    <script type="application/ld+json">not json at all</script>
  </head><body></body></html>`;
  const info = parseListingHtml("https://example.com/listing", html);
  assert.deepEqual(info.photos, ["https://photos.example.com/a.jpg", "https://photos.example.com/b.jpg"]);
  assert.equal(info.price, 512_000);
});

const REMARKS_OF_THE_HOUSE =
  "Updated rambler on a quiet street with a new roof and furnace. The detached shop was built in 2019 and has 1,200 sqft with 220 power. Sold as-is.";
const TOP_OF_THE_PAGE = ["Buy", "Rent", "Sell", "$549,000", "13013 224th St E, Graham, WA 98338", "4 bd 3 ba 2,340 sqft", "What's special", REMARKS_OF_THE_HOUSE];

test("a card of another home ends the house's part of the page, whatever the heading over it says", () => {
  const lines = [...TOP_OF_THE_PAGE, "Year built: 1987", "Keep exploring", "$612,000", "3 bd 2 ba 1,480 sqft", "9102 198th St E, Graham, WA 98338", "Year built: 2021", "Lot size: 0.31 acres"];
  const read = parsePastedListing("", lines.join("\n"));
  assert.deepEqual([read.price, read.beds, read.baths, read.sqft, read.address], [549_000, 4, 3, 2340, "13013 224th St E, Graham, WA 98338"]);
  assert.equal(read.facts?.yearBuilt?.value, 1987);
  // The card's own lot is not this house's, and no line of the card is kept as a detail.
  assert.equal(read.facts?.lotSqft, undefined);
  assert.equal(findAddresses(lines.join("\n")).includes("9102 198th St E, Graham, WA 98338"), false);

  // A card that leads with its address: the address goes with the card.
  const addressFirst = [...TOP_OF_THE_PAGE, "Keep exploring", "9102 198th St E, Graham, WA 98338", "$612,000", "3 bd 2 ba 1,480 sqft"];
  assert.deepEqual(findAddresses(addressFirst.join("\n")), ["13013 224th St E, Graham, WA 98338"]);
});

test("the house said a second time, its price history and its estimates are not cards of other homes", () => {
  // A bar that stays on screen, or a second summary for small screens: the same price again.
  const twice = [...TOP_OF_THE_PAGE, "$549,000", "4 bd 3 ba 2,340 sqft", "Facts & features", "Year built: 1987", "Lot size: 7,405 sqft"];
  assert.equal(parsePastedListing("", twice.join("\n")).facts?.yearBuilt?.value, 1987);
  assert.equal(parsePastedListing("", twice.join("\n")).facts?.lotSqft?.value, 7405);

  // Amounts by themselves on their lines, with no bedrooms under them.
  const history = [...TOP_OF_THE_PAGE, "Price history", "9/14/2026", "Listed for sale", "$569,000", "6/2/2019", "Sold", "$402,000", "Zestimate", "$561,200", "Facts & features", "Year built: 1987"];
  const read = parsePastedListing("", history.join("\n"));
  assert.deepEqual([read.price, read.facts?.yearBuilt?.value], [549_000, 1987]);

  // The house's own rooms listed under its facts are not a card either.
  const rooms = [...TOP_OF_THE_PAGE, "Home value", "$561,200", "Bedrooms & bathrooms", "Bedrooms: 4", "Bathrooms: 3", "Year built: 1987"];
  assert.equal(parsePastedListing("", rooms.join("\n")).facts?.yearBuilt?.value, 1987);
});

test("with nothing to tell a card by, what the page says first is still the house's", () => {
  // A few lines copied from the top of a page and the card under them: no remarks, no heading.
  const short = ["$549,000", "4 bd 3 ba 2,340 sqft", "13013 224th St E, Graham, WA 98338", "$612,000", "3 bd 2 ba 1,480 sqft", "9102 198th St E, Graham, WA 98338"];
  const read = parsePastedListing("", short.join("\n"));
  assert.deepEqual([read.price, read.beds, read.baths, read.sqft, read.address], [549_000, 4, 3, 2340, "13013 224th St E, Graham, WA 98338"]);

  // The house written as numbers over their labels, the card as one line.
  const over = ["$549,000", "4", "beds", "3", "baths", "2,340", "sqft", "13013 224th St E, Graham, WA 98338", "$612,000", "3 bd 2 ba 1,480 sqft", "9102 198th St E, Graham, WA 98338"];
  const second = parsePastedListing("", over.join("\n"));
  assert.deepEqual([second.price, second.beds, second.baths, second.sqft], [549_000, 4, 3, 2340]);
});

test("a measurement before the house number is not the house number, in whatever words it is given", () => {
  for (const before of ["850 Square Feet", "850 sq. ft.", "2 beds, 1 bath, 850 Square Feet", "2 full baths"]) {
    assert.equal(parseListingText(`$189,500 ${before} 712 Day Lily Ln, Lacey, WA 98503`).address, "712 Day Lily Ln, Lacey, WA 98503", before);
  }
  // ...and a street named with one of those words keeps its number.
  assert.equal(parseListingText("5 Square Hill Rd, Lacey, WA 98503").address, "5 Square Hill Rd, Lacey, WA 98503");
  assert.equal(parseListingText("12 Half Moon Ln, Lacey, WA 98503").address, "12 Half Moon Ln, Lacey, WA 98503");
});

// ── What the last check before step 2 went in found ────────────────────────

const HOUSE_ADDRESS = "13013 224th St E, Graham, WA 98338";
const REMARKS_WITH_NUMBERS = "This 4 bedroom rambler sits on a quiet street. Priced $20,000 under the 2025 appraisal for a quick sale. New roof and furnace. Sold as-is.";
const five = (lines: string[]) => {
  const read = parsePastedListing("", lines.join("\n"));
  return [read.price, read.beds, read.baths, read.sqft, read.address];
};

test("a two-column page reads its remarks before its price box, and the price box is still the house's", () => {
  // The remarks name a bedroom and an amount; the house's own price and rooms come after them.
  const page = [HOUSE_ADDRESS, "About this home", REMARKS_WITH_NUMBERS, "$549,000", "4 bd 3 ba 2,340 sqft", "Year built: 1987", "Sewer: Septic Tank"];
  assert.deepEqual(five(page), [549_000, 4, 3, 2340, HOUSE_ADDRESS]);
  const read = parsePastedListing("", page.join("\n"));
  assert.equal(read.facts?.yearBuilt?.value, 1987);
  assert.deepEqual(read.details, [{ label: "Sewer", value: "Septic Tank" }]);
  // A link in the price box that names other listings is not a heading over other homes.
  const withLink = [HOUSE_ADDRESS, "About this home", REMARKS_WITH_NUMBERS, "$549,000", "Other listings by this agent", "4 bd 3 ba 2,340 sqft", "Year built: 1987"];
  assert.deepEqual(five(withLink), [549_000, 4, 3, 2340, HOUSE_ADDRESS]);
  // Nor is a row of tabs over the price box.
  const withTabs = [HOUSE_ADDRESS, "About this home", REMARKS_WITH_NUMBERS, "Overview", "Facts and features", "Similar homes", "$549,000", "4 bd 3 ba 2,340 sqft", "Year built: 1987"];
  assert.deepEqual(five(withTabs), [549_000, 4, 3, 2340, HOUSE_ADDRESS]);
  assert.equal(parsePastedListing("", withTabs.join("\n")).facts?.yearBuilt?.value, 1987);
});

test("the asking price is found a few lines under the rooms, and not at all on a page that has none", () => {
  // A status, an open house, the remarks: then the price.
  assert.equal(five([HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "Single family residence", "Active", "Listed by Windfall Realty", "MLS #2301234", "Open house Sat 1-3", "$549,000"])[0], 549_000);
  assert.equal(five(["4 Bed, 3 Bath Home in Graham", HOUSE_ADDRESS, "About this home", REMARKS_WITH_NUMBERS, "$549,000", "2,340 sqft", "Year built: 1987"])[0], 549_000);
  // A lender's banner over the page is not the house's money: the price box under the remarks still is.
  assert.equal(five(["Get pre-approved for up to $600,000 today", "4 Bed, 3 Bath Home in Graham", HOUSE_ADDRESS, "About this home", REMARKS_WITH_NUMBERS, "$549,000", "2,340 sqft"])[0], 549_000);
  // What the house sold for, or an estimate of it, beside its rooms: the page has no asking price, and a price further down is another home's.
  const card = ["$612,000", "4 bd 3 ba 2,610 sqft"];
  assert.equal(five(["Sold for $549,000", "4 bd 3 ba 2,340 sqft", HOUSE_ADDRESS, "What's special", "Updated rambler.", ...card])[0], undefined);
  assert.equal(five(["Zestimate®: $561,200", "4 bd 3 ba 2,340 sqft", HOUSE_ADDRESS, "What's special", "Updated rambler.", ...card])[0], undefined);
  // An amount with a label by itself on the line above it, and the two ends of a range.
  assert.equal(five([HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "Home value", "$561,200", "$549,000"])[0], 549_000);
  assert.equal(five([HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "Estimated sales range", "$520,000 - $575,000", "$549,000"])[0], 549_000);
});

test("in one run of words, a label says which amount is other money", () => {
  const run = (between: string) => parseListingText(`For sale $549,000 ${between} 4 bd 3 ba 2,340 sqft ${HOUSE_ADDRESS}`).price;
  for (const between of ["Est. value: $561,200", "Estimated value $561,200", "Estimated value: $520,000 - $575,000", "Original price $575,000", "Appraised at $560,000", "Zestimate: $561,200", "Zestimate®: $561,200", "Market value $561,200"]) {
    assert.equal(run(between), 549_000, between);
  }
  // The label that follows its amount still belongs to the amount before it.
  assert.equal(parseListingText(`$561,200 Zestimate® $549,000 4 bd 3 ba 2,340 sqft ${HOUSE_ADDRESS}`).price, 549_000);
});

test("rooms and size written a few more ways", () => {
  const top = ["$549,000", HOUSE_ADDRESS];
  // The size on a line of its own with a word before it.
  assert.deepEqual(five([...top, "4 BR, 2.5 BA", "Approx. 2,340 sq. ft.", "What's special", "x"]).slice(1, 4), [4, 2.5, 2340]);
  // The lot between the baths and the size, also in one run of words.
  assert.deepEqual(five([...top, "4 bd · 3 ba · 0.17 acres · 2,340 sqft", "What's special", "x"]).slice(1, 4), [4, 3, 2340]);
  assert.equal(parseListingText(`$549,000 4 bd · 3 ba · 0.17 acres · 2,340 sqft ${HOUSE_ADDRESS}`).sqft, 2340);
  // Two full baths and one half, the way a listing service writes it.
  assert.deepEqual(five([...top, "Beds 4 | Baths 2/1 | SqFt 2,340", "What's special", "x"]).slice(1, 4), [4, 2.5, 2340]);
  // "3+" is a search filter's count, not a house's.
  const filtered = parsePastedListing("", ["Beds: 3+", "Baths: 2+", ...top, "4 bd 3 ba 2,340 sqft", "What's special", "x"].join("\n"));
  assert.deepEqual([filtered.beds, filtered.baths], [4, 3]);
});

test("the house's address is the one that stands with its price and rooms, not an office's", () => {
  // The office's address in the page header.
  assert.equal(five(["Windfall Realty", "100 Main St", "Tacoma, WA 98402", "$549,000", HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft"])[4], HOUSE_ADDRESS);
  assert.equal(parseListingText(`Windfall Realty 100 Main St Tacoma, WA 98402 $549,000 ${HOUSE_ADDRESS} 4 bd 3 ba 2,340 sqft`).address, HOUSE_ADDRESS);
  // With no brokerage's name over it, it is still not beside the rooms.
  assert.equal(five(["Jane Doe", "100 Main St", "Tacoma, WA 98402", "$549,000", "4 bd 3 ba 2,340 sqft", HOUSE_ADDRESS])[4], HOUSE_ADDRESS);
  // Under "Listed by" it is the office's by the page's own words: never the house's, also when the house's own cannot be read.
  const office = ["Listed by Windfall Realty", "100 Main St", "Tacoma, WA 98402"];
  assert.equal(five(["$549,000", "13013 224th St E · Graham · WA", "4 bd 3 ba 2,340 sqft", ...office])[4], undefined);
  // The house's own written the post office's way, without the comma before the state.
  assert.equal(five(["$549,000", "13013 224th St E, Graham WA 98338", "4 bd 3 ba 2,340 sqft", ...office])[4], HOUSE_ADDRESS);
  // A page that gives only one address gives the house's, whatever stands over it.
  assert.equal(five(["Windfall Realty", HOUSE_ADDRESS, "$549,000", "4 bd 3 ba 2,340 sqft"])[4], HOUSE_ADDRESS);
});

test("an estimate with the house's rooms repeated under it does not end the house's part of the page", () => {
  const remarks = "Updated rambler on a quiet street with a new roof and furnace. The detached shop was built in 2019. Sold as-is.";
  const top = ["$549,000", "4 bd 3 ba 2,340 sqft", HOUSE_ADDRESS, "What's special", remarks];
  for (const card of [["Home value", "$561,200", "4 beds · 3 baths · 2,340 sqft"], ["Suggested offer", "$535,000", "4 bd | 3 ba | 2,340 sqft"], ["Assessed value", "$412,000", "4 bedrooms"]]) {
    const read = parsePastedListing("", [...top, ...card, "Year built: 1987", "Sewer: Septic Tank"].join("\n"));
    assert.deepEqual([read.price, read.beds, read.sqft, read.facts?.yearBuilt?.value, read.details?.length], [549_000, 4, 2340, 1987, 1], card[0]);
  }
  // The same shape with an address the page has not given before is another home.
  const other = parsePastedListing("", [...top, "$612,000", "3 bd 2 ba 1,480 sqft", "9102 198th St E, Graham, WA 98338", "Year built: 2021"].join("\n"));
  assert.equal(other.facts?.yearBuilt, undefined);
});

test("a street over its city: the unit on a line of its own, and street names of more kinds", () => {
  assert.equal(findAddresses("123 Main St\nUnit 4\nSeattle, WA 98101")[0], "123 Main St Unit 4, Seattle, WA 98101");
  for (const street of ["123 Oak Trace", "45 Sleepy Hollow", "8 Gramercy Park", "200 Fox Chase", "17 Windsor Close", "301 River Bluff", "4567 Old Highway 99 S", "123 Main St Lot 5", "12 El Camino Real", "500 W Lake Sammamish Pkwy SE"]) {
    assert.equal(findAddresses(`${street}\nGraham, WA 98338`)[0], `${street}, Graham, WA 98338`, street);
  }
  // A number and a word are not enough to be a street: the line over a city is often something else.
  for (const above of ["100 Main", "24 Homes", "9 On The Green"]) assert.equal(findAddresses(`${above}\nGraham, WA 98338`)[0], undefined, above);
});

// ── ...and what the check of those fixes found ─────────────────────────────

test("what stands over the house's own address does not hand it to an office further down", () => {
  const rest = ["$549,000", "4 bd 3 ba 2,340 sqft", "What's special", "Updated rambler on a quiet street."];
  // A site's name, a breadcrumb or who listed it over the address; an office's or a school's address at the foot of the page.
  for (const over of ["Properties", "Graham Real Estate", "Windfall Realty", "Listing courtesy of Windfall Realty", "Homes for sale"]) {
    for (const foot of [["Visit us", "100 Main St, Tacoma, WA 98402"], ["Frontier Middle School", "10026 204th St E, Graham, WA 98338"]]) {
      assert.equal(five([over, HOUSE_ADDRESS, ...rest, ...foot])[4], HOUSE_ADDRESS, `${over} / ${foot[0]}`);
    }
  }
  // The only address on the page, under who listed it.
  for (const over of ["Presented by Jane Doe", "Listed by Windfall Realty"]) assert.equal(five([over, HOUSE_ADDRESS, ...rest])[4], HOUSE_ADDRESS, over);
  // The house's address in a title far above its price; an agent's card with the office's address under the rooms.
  const far = [HOUSE_ADDRESS, ...Array.from({ length: 20 }, (_, i) => `Photo ${i + 1}`), "$549,000", "4 bd 3 ba 2,340 sqft", "Jane Doe", "(253) 555-0100", "100 Main St, Tacoma, WA 98402"];
  assert.equal(five(far)[4], HOUSE_ADDRESS);
  // In one run of words, too.
  assert.equal(parseListingText(`Properties ${HOUSE_ADDRESS} $549,000 4 bd 3 ba 2,340 sqft What's special Updated rambler. Visit us 100 Main St, Tacoma, WA 98402`).address, HOUSE_ADDRESS);
  // A size written label first is not a house number, and a name between two numbers means the later one starts the address.
  assert.equal(parseListingText(`${HOUSE_ADDRESS} Beds 2 Baths 1 Sq Ft 850 Windfall Realty 100 Main St Tacoma, WA 98402 $189,500`).address, HOUSE_ADDRESS);
  assert.deepEqual(findAddresses("Sq Ft 850 Windfall Realty 100 Main St, Tacoma, WA 98402"), ["100 Main St, Tacoma, WA 98402"]);
  assert.deepEqual(findAddresses("see 1234 US 31 N, Franklin, IN 46131"), ["1234 US 31 N, Franklin, IN 46131"]);
});

test("a cut beside the price, an amount in a phrase over the rooms, and a page whose price cannot be read", () => {
  // The cut written with a hyphen right after the price is not the other end of a range.
  for (const line of ["$549,000 -$20,000", "$549,000 - $20,000 (3.5%)", "$549,000 (-$20,000)"]) assert.equal(five([line, HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "x", "y"])[0], 549_000, line);
  assert.equal(parseListingText(`$549,000 -$20,000 ${HOUSE_ADDRESS} 4 bd 3 ba 2,340 sqft`).price, 549_000);
  // A true range is still no single price.
  assert.equal(five(["$540,000 - $560,000", HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "x", "y"])[0], undefined);
  // An amount inside a phrase above the rooms loses to one with its line to itself under them.
  assert.equal(five(["$40,000 in upgrades since 2023", HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "$549,000", "What's special"])[0], 549_000);
  assert.equal(five(["Price reduced by $20,000", "4 Bed, 3 Bath Home in Graham", HOUSE_ADDRESS, "About this home", REMARKS_WITH_NUMBERS, "$549,000", "2,340 sqft"])[0], 549_000);
  // No readable asking price: a credit in a sentence under the rooms is not it.
  assert.equal(five(["$549K", HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "Seller will credit $15,000 toward closing", "What's special", "Updated rambler."])[0], undefined);
  // In one run of words the cut may come first: the much larger amount beside it is the price.
  assert.equal(parseListingText(`${HOUSE_ADDRESS} 4 bd 3 ba 2,340 sqft Price reduced $20,000 $549,000 Est. payment: $3,459/mo`).price, 549_000);
  assert.equal(parseListingText(`Buy with us and get $12,500 back $549,000 Est. $3,459/mo ${HOUSE_ADDRESS} 4 bd 3 ba 2,340 sqft Keep exploring Price: $489,000 Beds: 3`).price, 549_000);
});

test("cards under \"Similar homes\" in three more shapes give the house nothing", () => {
  const house = ["$549,000", "4 bd 3 ba 2,340 sqft", HOUSE_ADDRESS, "What's special", "Updated rambler on a quiet street with a new roof and furnace. The detached shop was built in 2019. Sold as-is.", "Sewer: Septic Tank"];
  const extras = ["0.25 acres", "3 days on Zillow", "Townhouse", "Built in 2004"];
  const shapes: Record<string, string[]> = {
    "street first": ["Similar homes", "9102 198th St E", "$489,000", "3 bd 2 ba 1,480 sqft", ...extras],
    "a line each": ["Similar homes", "$489,000 · 3 bd 2 ba 1,480 sqft · 9102 198th St E", ...extras],
    "no zip, a heading the reader does not know": ["Keep exploring", "$489,000", "3 bd 2 ba 1,480 sqft", "9102 198th St E, Graham, WA", ...extras],
    "street only, a heading the reader does not know": ["Keep exploring", "$489,000", "3 bd 2 ba 1,480 sqft", "9102 198th St E", ...extras],
  };
  for (const [name, cards] of Object.entries(shapes)) {
    const read = parsePastedListing("", [...house, ...cards].join("\n"));
    assert.deepEqual([read.price, read.beds, read.sqft, read.address], [549_000, 4, 2340, HOUSE_ADDRESS], name);
    assert.deepEqual([read.facts?.yearBuilt, read.facts?.lotSqft, read.facts?.daysOnMarket, read.facts?.propertyType], [undefined, undefined, undefined, undefined], name);
  }
  // The same words over the house's own price box, on a page that leads with a title, end nothing.
  const title = ["4 Bed, 3 Bath Home in Graham", "Overview", "Similar homes", HOUSE_ADDRESS, "$549,000", "4 bd 3 ba 2,340 sqft", "Year built: 1987"];
  const read = parsePastedListing("", title.join("\n"));
  assert.deepEqual([read.price, read.beds, read.address, read.facts?.yearBuilt?.value], [549_000, 4, HOUSE_ADDRESS, 1987]);
});

test("a size right under a line that names another space is that space's", () => {
  const read = parsePastedListing("", ["$549,000", HOUSE_ADDRESS, "4 bd 3 ba", "Shop", "Approx. 1,200 sq. ft.", "Living area: 2,340 sqft", "What's special", "x"].join("\n"));
  assert.equal(read.sqft, 2340);
});

// ── ...and the last check ──────────────────────────────────────────────────

test("the price a listing had, shown after the price it has, is not the asking price", () => {
  const rest = [HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "What's special"];
  // On the next line, on the same line, said twice, after the monthly payment, with the drop under it.
  for (const top of [["$549,000", "$575,000"], ["$549,000 $575,000"], ["$549,000 $575,000", "$575,000"], ["$549,000 Est. $3,459/mo", "$575,000"], ["$549,000", "$575,000", "-4.5%"], ["Price: $549,000", "$575,000"]]) {
    assert.equal(five([...top, ...rest])[0], 549_000, top.join(" / "));
    assert.equal(parseListingText([...top, ...rest].join(" ")).price, 549_000, `one run: ${top.join(" ")}`);
  }
  // The other way round, the old price first, the nearer one is still the price.
  assert.equal(five(["$575,000", "$549,000", ...rest])[0], 549_000);
  // A number over its label is that label's: an estimate, a cash offer.
  assert.equal(five([HOUSE_ADDRESS, "$549,000", "Price", "$561,200", "Estimate", "4 bd 3 ba 2,340 sqft"])[0], 549_000);
  assert.equal(five([HOUSE_ADDRESS, "$549,000", "$530,400", "Estimated value", "4 bd 3 ba 2,340 sqft"])[0], 549_000);
  assert.equal(five([HOUSE_ADDRESS, "$549,000", "Get a cash offer", "$521,000", "4 bd 3 ba 2,340 sqft"])[0], 549_000);
  assert.equal(five(["Active | $549,000", "4 bd 3 ba 2,340 sqft", HOUSE_ADDRESS, "$561,200", "Estimated value"])[0], 549_000);
  assert.equal(parseListingText(`${HOUSE_ADDRESS} $549,000 Price $561,200 Estimate 4 bd 3 ba 2,340 sqft`).price, 549_000);
  // ...but a label with an amount right under it is that amount's, and the price over it stays the price.
  assert.equal(five([HOUSE_ADDRESS, "$549,000", "Home value", "$561,200", "4 bd 3 ba 2,340 sqft"])[0], 549_000);
  // A button that starts with the same word is not a label.
  assert.equal(parseListingText(`$549,000 Estimate your payment ${HOUSE_ADDRESS} 4 bd 3 ba 2,340 sqft`).price, 549_000);
});

test("two small things the one-run text got wrong", () => {
  // "lot" after a measurement ends the measurement: the number after it is the house's.
  assert.equal(parseListingText(`$549,000 4 bd 3 ba 2,340 sqft 7,405 sqft lot ${HOUSE_ADDRESS}`).address, HOUSE_ADDRESS);
  assert.equal(findAddresses("Lot 12 Sunrise Estates, Graham, WA 98338")[0], undefined);
  // An amount inside a phrase right after the rooms is not "on their line".
  assert.equal(parseListingText(`$549K ${HOUSE_ADDRESS} 4 bd 3 ba 2,340 sqft Seller will credit $15,000 toward closing`).price, undefined);
  // The lot, in square feet, between the baths and the size.
  assert.equal(parseListingText(`$549,000 4 bd · 3 ba · 7,405 sqft lot · 2,340 sqft ${HOUSE_ADDRESS}`).sqft, 2340);
});

test("a page's <title> is not a line of the page: a site's name in it does not stand over the address", () => {
  // The house's address leads the page, twenty lines over its price; an agent's card with the office's address under the rooms.
  const lines = [HOUSE_ADDRESS, ...Array.from({ length: 18 }, (_, i) => `Photo ${i + 1} of 18`), "$549,000", "4 bd 3 ba 2,340 sqft", "Jane Doe", "(253) 555-0100", "100 Main St, Tacoma, WA 98402", "What's special", "Updated rambler."];
  const html = `<html><head><title>Windfall Realty</title></head><body>${lines.map((line) => `<div>${line}</div>`).join("")}</body></html>`;
  const read = parseListingHtml("https://www.windfall.example/listing/2301234", html);
  assert.deepEqual([read.price, read.beds, read.address], [549_000, 4, HOUSE_ADDRESS]);
  // What the title itself says is still read, the way a link preview is.
  const titled = `<html><head><title>${HOUSE_ADDRESS} | MLS #2301234 | Windfall Realty</title></head><body><div>$549,000</div><div>4 bd 3 ba 2,340 sqft</div><div>x</div><div>y</div><div>z</div></body></html>`;
  const second = parseListingHtml("https://www.windfall.example/listing/2301234", titled);
  assert.deepEqual([second.address, second.facts?.mlsId?.value], [HOUSE_ADDRESS, "2301234"]);
});

test("\"Property value\" over a price is a label a site may give its asking price", () => {
  assert.equal(five(["Property value", "$549,000", HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft", "x"])[0], 549_000);
  // "Home value" and "Market value" are what somebody thinks it is worth.
  assert.equal(five(["$549,000", "Home value", "$561,200", HOUSE_ADDRESS, "4 bd 3 ba 2,340 sqft"])[0], 549_000);
});
