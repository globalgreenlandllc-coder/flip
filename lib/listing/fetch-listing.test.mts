import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListingHtml } from "./fetch-listing.ts";

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
