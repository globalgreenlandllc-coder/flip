import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFromUrl, dedupePhotos, parseListingHtml } from "./fetch-listing.ts";

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
