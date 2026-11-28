import { test } from "node:test";
import assert from "node:assert/strict";
import { accountOf, activeIn, journeys, mapPins, pageName, pageStage, platformKey, sourceCards, sourceOf, stageCounts, summary, tiles, topSource, withoutOwnerRows, type TrafficRow } from "./traffic.ts";
import { STAGES, newSignups, railOf, signupStep, spanOf } from "./traffic-shared.ts";

const NOW = new Date("2026-11-28T00:30:00Z"); // 4:30 PM Pacific, Nov 27
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);
const row = (over: Partial<TrafficRow>): TrafficRow => ({
  createdAt: min(1),
  visitor: "aaaa0000aaaa0000aaaa0000aaaa0000",
  own: false,
  path: "/",
  referrer: null,
  country: "US",
  region: "WA",
  city: "Tacoma",
  lat: 47.25,
  lng: -122.44,
  signedIn: false,
  userId: null,
  device: "phone",
  browser: "Safari",
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  clickFrom: null,
  adClick: false,
  ...over,
});
const none = new Map<string, Date>();

test("a page's stage: signed in is a member; the sign-up and sign-in pages; anything else is looking around", () => {
  assert.equal(pageStage({ path: "/", signedIn: false }), "browsing");
  assert.equal(pageStage({ path: "/sign-up", signedIn: false }), "signing-up");
  assert.equal(pageStage({ path: "/sign-up/verify-email-address", signedIn: false }), "signing-up");
  assert.equal(pageStage({ path: "/sign-in/factor-one", signedIn: false }), "signing-in");
  assert.equal(pageStage({ path: "/app", signedIn: true }), "member");
  assert.equal(pageStage({ path: "/", signedIn: true }), "member");
  // Not a sign-up page because it starts with the same letters.
  assert.equal(pageStage({ path: "/sign-upx", signedIn: false }), "browsing");
});

test("where a visit came from: a paid tag is an ad, a click id is an ad unless the tag says it was not paid", () => {
  assert.deepEqual(sourceOf(row({ utmSource: "facebook", utmMedium: "paid_social", utmCampaign: "Decks Nov", adClick: true })), { platform: "facebook", label: "Facebook", ad: true, campaign: "Decks Nov" });
  assert.equal(sourceOf(row({ utmSource: "fb", utmMedium: "cpc" })).ad, true);
  assert.equal(sourceOf(row({ utmSource: "ig" })).platform, "instagram");
  assert.equal(sourceOf(row({ utmSource: "instagram", utmMedium: "social", adClick: true })).ad, false);
  assert.equal(sourceOf(row({ utmSource: "newsletter", utmMedium: "email" })).ad, false);
  // A paid-only click id alone (gclid, no tags) is an ad, from the network the id belongs to.
  assert.deepEqual(sourceOf(row({ clickFrom: "google", adClick: true })), { platform: "google", label: "Google", ad: true, campaign: null });
  // Facebook's fbclid alone: Facebook, not an ad (Facebook adds it to every link).
  assert.deepEqual(sourceOf(row({ clickFrom: "facebook", adClick: false })), { platform: "facebook", label: "Facebook", ad: false, campaign: null });
  // fbclid on a link tagged as paid: an ad.
  assert.equal(sourceOf(row({ utmSource: "facebook", utmMedium: "paid_social", clickFrom: "facebook" })).ad, true);
  // An unknown medium with a click id: an ad.
  assert.equal(sourceOf(row({ utmSource: "google", utmMedium: "pmax", adClick: true })).ad, true);
});

test("without tags: the other site, then the app the page was opened in, else Direct", () => {
  assert.equal(sourceOf(row({ referrer: "l.facebook.com" })).platform, "facebook");
  assert.equal(sourceOf(row({ referrer: "google.co.uk" })).label, "Google");
  assert.equal(sourceOf(row({ referrer: "t.co" })).platform, "x");
  assert.equal(sourceOf(row({ referrer: "news.ycombinator.com" })).platform, "news.ycombinator.com");
  assert.equal(sourceOf(row({ browser: "Instagram app" })).platform, "instagram");
  assert.equal(sourceOf(row({ browser: "Facebook app" })).ad, false);
  assert.deepEqual(sourceOf(row({})), { platform: "direct", label: "Direct", ad: false, campaign: null });
  // A fake host that only ends like a network is not that network.
  assert.equal(sourceOf(row({ referrer: "notfacebook.com" })).platform, "notfacebook.com");
});

test("one visit per fingerprint: pages in order, the furthest stage, newest move first", () => {
  const rows = [
    row({ visitor: "b".repeat(32), createdAt: min(20), path: "/" }),
    row({ visitor: "b".repeat(32), createdAt: min(18), path: "/sign-up" }),
    row({ visitor: "c".repeat(32), createdAt: min(2), path: "/", utmSource: "facebook", utmMedium: "paid_social", adClick: true }),
    row({ visitor: "c".repeat(32), createdAt: min(1), path: "/app/analyze", utmSource: null }),
  ];
  const list = journeys(rows, NOW, none);
  assert.deepEqual(list.map((j) => j.id[0]), ["c", "b"]);
  const [c, b] = list;
  assert.equal(b.stage, "signing-up");
  assert.equal(b.onSiteNow, false);
  assert.deepEqual(b.pages.map((p) => p.path), ["/", "/sign-up"]);
  assert.equal(c.onSiteNow, true);
  // The ad tags were on the first page only; the visit keeps them.
  assert.equal(c.source.ad, true);
  assert.equal(c.source.platform, "facebook");
});

test("signed up: the account was made during its signed-in visit; an older account is a member", () => {
  const rows = [
    row({ visitor: "d".repeat(32), createdAt: min(10), path: "/sign-up" }),
    row({ visitor: "d".repeat(32), createdAt: min(8), path: "/app", signedIn: true, userId: "user_new" }),
    row({ visitor: "e".repeat(32), createdAt: min(5), path: "/app", signedIn: true, userId: "user_old" }),
  ];
  const accounts = new Map([
    ["user_new", min(9)],
    ["user_old", new Date("2026-10-01T00:00:00Z")],
  ]);
  const byId = Object.fromEntries(journeys(rows, NOW, accounts).map((j) => [j.id, j]));
  assert.equal(byId["u:2026-11-27:user_new"].stage, "signed-up");
  assert.deepEqual(byId["u:2026-11-27:user_new"].pages.map((p) => p.path), ["/app"]);
  assert.equal(byId["u:2026-11-27:user_old"].stage, "member");
  // The sign-up form was seen signed out: an anonymous visit of its own, never under the new name.
  assert.equal(byId["d".repeat(32)].userId, null);
  assert.equal(byId["d".repeat(32)].stage, "signing-up");
  // Without knowing when the account was made, a signed-in visit is a member.
  assert.equal(journeys(rows, NOW, none).find((j) => j.id === "u:2026-11-27:user_new")?.stage, "member");
});

test("one fingerprint shared by two people: anonymous pages never land under a name, and two accounts never merge", () => {
  const shared = "s".repeat(32);
  const rows = [
    row({ visitor: shared, createdAt: min(9), path: "/app/find" }),
    row({ visitor: shared, createdAt: min(7), path: "/app", signedIn: true, userId: "user_a" }),
    row({ visitor: shared, createdAt: min(6), path: "/app/deals", signedIn: true, userId: "user_b" }),
    row({ visitor: shared, createdAt: min(4), path: "/" }),
  ];
  const list = journeys(rows, NOW, none);
  assert.deepEqual(list.map((j) => j.id).sort(), ["s".repeat(32), "u:2026-11-27:user_a", "u:2026-11-27:user_b"]);
  const anon = list.find((j) => j.id === shared);
  assert.equal(anon?.userId, null);
  assert.deepEqual(anon?.pages.map((p) => p.path), ["/app/find", "/"]);
  assert.deepEqual(list.find((j) => j.id === "u:2026-11-27:user_a")?.pages.map((p) => p.path), ["/app"]);
  // The window finds each visit by its own key: an anonymous visit long over is not brought back by a signed-in page.
  const later = [row({ visitor: shared, createdAt: min(90), path: "/" }), row({ visitor: shared, createdAt: min(3), path: "/app", signedIn: true, userId: "user_a" })];
  assert.deepEqual(journeys(activeIn(later, min(30)), NOW, none).map((j) => j.id), ["u:2026-11-27:user_a"]);
});

test("the window keeps a visitor's earlier pages that day; the owner's fingerprints go whole", () => {
  const rows = [
    row({ visitor: "f".repeat(32), createdAt: min(90), path: "/" }),
    row({ visitor: "f".repeat(32), createdAt: min(3), path: "/app/find" }),
    row({ visitor: "g".repeat(32), createdAt: min(90), path: "/" }),
    row({ visitor: "h".repeat(32), createdAt: min(4), path: "/" }),
    row({ visitor: "h".repeat(32), createdAt: min(2), path: "/app/admin", own: true, signedIn: true, userId: "owner" }),
  ];
  const active = activeIn(rows, min(30));
  assert.deepEqual([...new Set(active.map((r) => r.visitor[0]))].sort(), ["f", "h"]);
  // h's signed-out page at 4 minutes is active on its own key.
  assert.equal(active.filter((r) => r.visitor[0] === "f").length, 2);
  assert.deepEqual([...new Set(withoutOwnerRows(rows, new Set()).map((r) => r.visitor[0]))].sort(), ["f", "g"]);
  // An owner's account found by id, even on a row not marked own.
  assert.deepEqual([...new Set(withoutOwnerRows([row({ visitor: "i".repeat(32), signedIn: true, userId: "owner" })], new Set(["owner"])))], []);
});

test("the tiles: on the site now, today, and yesterday by the same time (Pacific days)", () => {
  const rows = [
    row({ visitor: "1".repeat(32), createdAt: min(2) }),
    row({ visitor: "2".repeat(32), createdAt: min(200) }),
    // Yesterday (Nov 26 Pacific), earlier than this time of day: counted.
    row({ visitor: "3".repeat(32), createdAt: new Date("2026-11-26T20:00:00Z") }),
    // Yesterday, later than this time of day: not "by this time".
    row({ visitor: "4".repeat(32), createdAt: new Date("2026-11-27T06:00:00Z") }),
  ];
  assert.deepEqual(tiles(rows, NOW, 2), { onSiteNow: 1, visitorsToday: 2, sameTimeYesterday: 1, signedUpToday: 2 });
});

test("the counts by stage and the source cards", () => {
  const list = journeys(
    [
      row({ visitor: "j".repeat(32), utmSource: "instagram", utmMedium: "paid_social", adClick: true }),
      row({ visitor: "k".repeat(32), referrer: "instagram.com", path: "/sign-up" }),
      row({ visitor: "l".repeat(32) }),
    ],
    NOW,
    none,
  );
  const counts = stageCounts(list);
  assert.equal(counts.browsing, 2);
  assert.equal(counts["signing-up"], 1);
  assert.equal(STAGES.reduce((a, s) => a + counts[s], 0), 3);
  const { cards, nothingYet } = sourceCards(list, list);
  assert.deepEqual(cards.map((c) => [c.platform, c.total, c.ads, c.organic, c.signingUp, c.today]), [
    ["instagram", 2, 1, 1, 1, 2],
    ["direct", 1, 0, 1, 0, 1],
  ]);
  assert.deepEqual(nothingYet.map((p) => p.platform), ["facebook", "google", "tiktok", "x"]);
  assert.deepEqual(topSource(cards), { label: "Instagram", count: 2 });
  assert.equal(topSource(cards.filter((c) => c.platform === "direct")), null);
});

test("the one sentence", () => {
  assert.equal(
    summary({ onSiteNow: 3, lastHalfHour: 12, top: { label: "Instagram", count: 5 }, visitorsToday: 40, sameTimeYesterday: 50, signedUpToday: 1 }),
    "3 on the site now, and 12 came through in the last 30 minutes; Instagram brought the most (5). 40 visitors today, 20% behind this time yesterday. 1 signed up today.",
  );
  assert.equal(
    summary({ onSiteNow: 0, lastHalfHour: 2, top: null, visitorsToday: 1, sameTimeYesterday: 0, signedUpToday: 0 }),
    "Nobody on the site this minute, but 2 came through in the last 30 minutes. 1 visitor today, and none by this time yesterday. Nobody has signed up today.",
  );
  assert.equal(summary({ onSiteNow: 0, lastHalfHour: 0, top: null, visitorsToday: 0, sameTimeYesterday: 0, signedUpToday: null }), "Nobody on the site in the last 30 minutes. 0 visitors today.");
  assert.match(summary({ onSiteNow: 1, lastHalfHour: 1, top: null, visitorsToday: 10, sameTimeYesterday: 10, signedUpToday: 0 }), /10 visitors today, the same as this time yesterday\./);
});

test("map pins: only visitors with a place, nudged apart the same way each time, at most 400", () => {
  const list = journeys([row({ visitor: "abcd1234".padEnd(32, "0") }), row({ visitor: "ffff0000".padEnd(32, "0"), lat: null, lng: null, city: null, region: null, country: null })], NOW, none);
  const { pins, cut } = mapPins(list);
  assert.equal(pins.length, 1);
  // The pin carries the same id as the list's row.
  assert.equal(pins[0].visitor, list.find((j) => j.lat !== null)?.id);
  assert.equal(cut, false);
  assert.ok(Math.abs(pins[0].lat - 47.25) <= 0.015 && Math.abs(pins[0].lng + 122.44) <= 0.015);
  assert.deepEqual(mapPins(list).pins, pins);
  const many = journeys(Array.from({ length: 450 }, (_, i) => row({ visitor: i.toString(16).padStart(32, "0"), createdAt: min(i % 25) })), NOW, none);
  assert.equal(mapPins(many).pins.length, 400);
  assert.equal(mapPins(many).cut, true);
});

test("the chime: only for a sign-up not seen on the last poll, never on the first poll", () => {
  assert.deepEqual(newSignups(null, ["a", "b"]), []);
  assert.deepEqual(newSignups(new Set(["a"]), ["a", "b"]), ["b"]);
  assert.deepEqual(newSignups(new Set(["a", "b"]), ["a"]), []);
});

test("the chime's memory survives a poll that could not read the sign-ups", () => {
  let step = signupStep(null, ["a"]);
  assert.deepEqual(step.chime, []);
  step = signupStep(step.seen, null);
  assert.deepEqual([...(step.seen ?? [])], ["a"]);
  assert.deepEqual(step.chime, []);
  // "a" is not new after the failed read; "b" is.
  step = signupStep(step.seen, ["a", "b"]);
  assert.deepEqual(step.chime, ["b"]);
});

test("every source key can be carried by the page's filter", () => {
  const safe = /^[a-z0-9.-]{1,100}$/;
  assert.equal(sourceOf(row({ utmSource: "Spring Newsletter!" })).platform, "spring-newsletter");
  assert.equal(sourceOf(row({ utmSource: "Spring Newsletter!" })).label, "Spring Newsletter!");
  assert.equal(platformKey("___"), "other");
  for (const tag of ["Partner Site", "ÄÖÜ", "a/b?c", "x".repeat(120)]) assert.match(sourceOf(row({ utmSource: tag })).platform, safe, tag);
  assert.match(sourceOf(row({ referrer: "my_site.example" })).platform, safe);
});

test("pages by name, spans and rail choices fall back to their defaults", () => {
  assert.equal(pageName("/"), "Home page");
  assert.equal(pageName("/app/deals/[id]"), "A saved deal");
  assert.equal(pageName("/sign-up/continue"), "Sign-up form");
  assert.equal(pageName("/something"), "/something");
  assert.equal(spanOf("7d").label, "7 days");
  assert.equal(spanOf("forever").key, "1d");
  assert.equal(railOf("30d").days, 30);
  assert.equal(railOf(undefined).key, "today");
});

test("a signed-in person's visit is one day's: yesterday's pages never join today's row, and yesterday's account is not 'signed up' today", () => {
  const rows = [
    row({ visitor: "y".repeat(32), createdAt: new Date("2026-11-27T05:00:00Z"), path: "/app/quick", signedIn: true, userId: "user_m" }), // Nov 26, 9 PM Pacific
    row({ visitor: "t".repeat(32), createdAt: min(4), path: "/app", signedIn: true, userId: "user_m" }),
  ];
  const made = new Map([["user_m", new Date("2026-11-27T04:55:00Z")]]); // made yesterday, Pacific
  const list = journeys(rows, NOW, made);
  assert.deepEqual(list.map((j) => j.id), ["u:2026-11-27:user_m", "u:2026-11-26:user_m"]);
  assert.deepEqual(list[0].pages.map((p) => p.path), ["/app"]);
  assert.equal(list[0].stage, "member");
  assert.equal(list[1].stage, "signed-up");
  assert.equal(accountOf(list[0].id), "user_m");
  assert.equal(accountOf("f".repeat(32)), null);
  // The live window takes today's visit only.
  assert.deepEqual(journeys(activeIn(rows, min(30)), NOW, made).map((j) => j.id), ["u:2026-11-27:user_m"]);
});
