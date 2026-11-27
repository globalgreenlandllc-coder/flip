import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VISITS_PER_DAY, addressId, areaDay, cleanPath, clientAddress, fromOwnPage, looksLikeAProgram, placeFromHeaders, referrerHost, visitorId, visitsPerDay } from "./visit.ts";

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("the day is the area's: 5 PM Pacific is still that day, not UTC's next one", () => {
  assert.equal(areaDay(new Date("2026-11-28T01:00:00Z")), "2026-11-27");
  assert.equal(areaDay(new Date("2026-11-28T08:30:00Z")), "2026-11-28");
  // Summer time.
  assert.equal(areaDay(new Date("2026-07-01T06:59:00Z")), "2026-06-30");
});

test("a path is kept without its query, and an id in it is never kept", () => {
  assert.equal(cleanPath("/"), "/");
  assert.equal(cleanPath("/app/deals"), "/app/deals");
  assert.equal(cleanPath("/app/deals/"), "/app/deals");
  assert.equal(cleanPath("/app/deals/cmi8x2k4f0001ab12cd34ef56"), "/app/deals/[id]");
  assert.equal(cleanPath("/app/analyze?link=https%3A%2F%2Fzillow.com%2Fhome%2F123"), "/app/analyze");
  assert.equal(cleanPath("/app/find#map"), "/app/find");
  assert.equal(cleanPath("/sign-in/factor-one"), "/sign-in/factor-one");
  assert.equal(cleanPath("/sign-in/sso-callback"), "/sign-in/sso-callback");
  // Not a plain word: written [id].
  assert.equal(cleanPath("/x/John%20Smith"), "/x/[id]");
  assert.equal(cleanPath("/x/Upper"), "/x/[id]");
  assert.equal(cleanPath("/x/a@b.com"), "/x/[id]");
  // At most six parts.
  assert.equal(cleanPath("/a/b/c/d/e/f/g/h"), "/a/b/c/d/e/f");
});

test("what is not a path of this site is refused", () => {
  for (const bad of [undefined, null, 3, "", "app", "//evil.example/x", "https://x.example/", "/".padEnd(501, "a")]) assert.equal(cleanPath(bad), null, String(bad));
});

test("the place is what Vercel sends, rounded to about a kilometre", () => {
  const place = placeFromHeaders(headers({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "WA", "x-vercel-ip-city": "Tacoma", "x-vercel-ip-latitude": "47.2529", "x-vercel-ip-longitude": "-122.4443" }));
  assert.deepEqual(place, { country: "US", region: "WA", city: "Tacoma", lat: 47.25, lng: -122.44 });
});

test("a city written with non-ASCII letters is read back", () => {
  assert.equal(placeFromHeaders(headers({ "x-vercel-ip-city": "S%C3%A3o%20Paulo" })).city, "São Paulo");
  // Not encoded the way Vercel does: kept as it came.
  assert.equal(placeFromHeaders(headers({ "x-vercel-ip-city": "100%" })).city, "100%");
});

test("a value that is not what Vercel sends is dropped", () => {
  const place = placeFromHeaders(headers({ "x-vercel-ip-country": "USA", "x-vercel-ip-country-region": "Washington", "x-vercel-ip-city": "x".repeat(81), "x-vercel-ip-latitude": "91", "x-vercel-ip-longitude": "-122.4" }));
  assert.deepEqual(place, { country: null, region: null, city: null, lat: null, lng: null });
  // A spot needs both halves, and 0,0 is nobody's city.
  assert.equal(placeFromHeaders(headers({ "x-vercel-ip-latitude": "47.2" })).lat, null);
  assert.equal(placeFromHeaders(headers({ "x-vercel-ip-latitude": "0", "x-vercel-ip-longitude": "0" })).lat, null);
  assert.equal(placeFromHeaders(headers({ "x-vercel-ip-latitude": "47.2; drop", "x-vercel-ip-longitude": "-122" })).lat, null);
  // Control characters are taken out of a city.
  assert.equal(placeFromHeaders(headers({ "x-vercel-ip-city": "Ta%0Acoma" })).city, "Tacoma");
});

test("off Vercel there is no place", () => {
  assert.deepEqual(placeFromHeaders(headers({})), { country: null, region: null, city: null, lat: null, lng: null });
});

test("the site a visitor came from is kept as its host, and this site's own pages are not one", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=flip", "www.renoflip.app"), "google.com");
  assert.equal(referrerHost("https://l.facebook.com/l.php?u=x", "www.renoflip.app"), "l.facebook.com");
  assert.equal(referrerHost("https://www.renoflip.app/app", "www.renoflip.app"), null);
  assert.equal(referrerHost("https://renoflip.app/", "www.renoflip.app"), null);
  assert.equal(referrerHost("https://accounts.renoflip.app/sign-in", "www.renoflip.app"), null);
  assert.equal(referrerHost("https://healthy-feline-5387.accounts.dev/sign-in", "www.renoflip.app"), null);
  assert.equal(referrerHost("http://localhost:3417/", "localhost:3417"), null);
  for (const bad of ["", "not a link", "javascript:alert(1)", "file:///etc/passwd", 7, null]) assert.equal(referrerHost(bad, "www.renoflip.app"), null, String(bad));
});

test("programs are not visitors; browsers are", () => {
  assert.equal(looksLikeAProgram(CHROME), false);
  assert.equal(looksLikeAProgram("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), false);
  // A person reading in a chat app's own browser: the app's name is in it, and it is still a person.
  assert.equal(looksLikeAProgram("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Telegram-Android/11.4.2"), false);
  assert.equal(looksLikeAProgram("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]"), false);
  for (const ua of [null, "", "curl/8.4.0", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", CHROME.replace("Chrome/", "HeadlessChrome/"), "python-requests/2.31", "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"]) {
    assert.equal(looksLikeAProgram(ua), true, String(ua));
  }
});

test("the fingerprint: the same visitor under the day's key, another one under the next day's, and no address in it", () => {
  const a = visitorId("key-of-the-27th", "203.0.113.7", CHROME);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(visitorId("key-of-the-27th", "203.0.113.7", CHROME), a);
  assert.notEqual(visitorId("key-of-the-28th", "203.0.113.7", CHROME), a);
  assert.notEqual(visitorId("key-of-the-27th", "203.0.113.8", CHROME), a);
  assert.notEqual(visitorId("key-of-the-27th", "203.0.113.7", `${CHROME} Edg/131`), a);
  assert.ok(!a.includes("203"));
  // The address alone: the same whatever the browser, another under another day's key, never a visitor's fingerprint.
  const s1 = addressId("key-of-the-27th", "203.0.113.7");
  assert.match(s1, /^[0-9a-f]{32}$/);
  assert.notEqual(s1, a);
  assert.notEqual(addressId("key-of-the-28th", "203.0.113.7"), s1);
  assert.notEqual(addressId("key-of-the-27th", "203.0.113.8"), s1);
  assert.notEqual(addressId("key-of-the-27th", ""), visitorId("key-of-the-27th", "", ""));
});

test("everyone's pages kept in a day: the setting, else 20,000", () => {
  assert.equal(visitsPerDay({}), DEFAULT_VISITS_PER_DAY);
  assert.equal(visitsPerDay({ FLIP_VISITS_PER_DAY: "500" }), 500);
  assert.equal(visitsPerDay({ FLIP_VISITS_PER_DAY: "0" }), 0);
  for (const bad of ["", " ", "-1", "1.5", "lots"]) assert.equal(visitsPerDay({ FLIP_VISITS_PER_DAY: bad }), DEFAULT_VISITS_PER_DAY, bad);
});

test("the visitor's address: the first one Vercel passes on", () => {
  assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientAddress(headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientAddress(headers({})), "");
});

test("only this site's own pages are listened to", () => {
  assert.equal(fromOwnPage(headers({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(fromOwnPage(headers({ "sec-fetch-site": "cross-site", origin: "https://www.renoflip.app", host: "www.renoflip.app" })), false);
  assert.equal(fromOwnPage(headers({ "sec-fetch-site": "same-site" })), false);
  assert.equal(fromOwnPage(headers({ "sec-fetch-site": "none" })), false);
  // A browser too old to say: its page's origin must be this host.
  assert.equal(fromOwnPage(headers({ origin: "https://www.renoflip.app", host: "www.renoflip.app" })), true);
  assert.equal(fromOwnPage(headers({ origin: "https://evil.example", host: "www.renoflip.app" })), false);
  assert.equal(fromOwnPage(headers({ host: "www.renoflip.app" })), false);
  assert.equal(fromOwnPage(headers({ origin: "null", host: "www.renoflip.app" })), false);
});
