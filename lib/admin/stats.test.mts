import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKeys, onDays, perDay, pins, placeName, top, visitorCount, visitorsPerDay, withoutOwner, type VisitRow } from "./stats.ts";

const visit = (over: Partial<VisitRow>): VisitRow => ({ createdAt: new Date("2026-11-27T20:00:00Z"), visitor: "v1", own: false, path: "/", referrer: null, country: "US", region: "WA", city: "Tacoma", lat: 47.25, lng: -122.44, ...over });

test("the days end with today's on the area's clock, oldest first", () => {
  // 01:00 UTC on the 28th is still the 27th in Seattle.
  assert.deepEqual(dayKeys(new Date("2026-11-28T01:00:00Z"), 3), ["2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.deepEqual(dayKeys(new Date("2026-03-01T20:00:00Z"), 2), ["2026-02-28", "2026-03-01"]);
  // Across the clock change in November: no day twice, none missing.
  const days = dayKeys(new Date("2026-11-10T20:00:00Z"), 14);
  assert.equal(new Set(days).size, 14);
  assert.equal(days[0], "2026-10-28");
});

test("moments are counted on their area day; moments outside the days are not", () => {
  const days = ["2026-11-26", "2026-11-27"];
  const at = ["2026-11-27T07:59:00Z", "2026-11-27T08:01:00Z", "2026-11-28T07:00:00Z", "2026-11-28T08:00:00Z", "2026-11-20T12:00:00Z"].map((s) => new Date(s));
  assert.deepEqual(perDay(at, days), [1, 2]);
  assert.equal(onDays(at, days, (d) => d).length, 3);
});

test("a visitor is counted once a day, and the days are added up", () => {
  const days = ["2026-11-26", "2026-11-27"];
  const rows = [
    visit({ visitor: "a", createdAt: new Date("2026-11-26T20:00:00Z") }),
    visit({ visitor: "a", createdAt: new Date("2026-11-26T21:00:00Z") }),
    visit({ visitor: "b", createdAt: new Date("2026-11-26T22:00:00Z") }),
    // The next day the same person has another fingerprint.
    visit({ visitor: "a2", createdAt: new Date("2026-11-27T20:00:00Z") }),
  ];
  assert.deepEqual(visitorsPerDay(rows, days), [2, 1]);
  assert.equal(visitorCount(rows), 3);
});

test("one pin a place, the busiest first, with its visitors and pages", () => {
  const rows = [
    visit({ visitor: "a" }),
    visit({ visitor: "a", path: "/app" }),
    visit({ visitor: "b", city: "Seattle", lat: 47.61, lng: -122.33 }),
    visit({ visitor: "c", city: "Seattle", lat: 47.61, lng: -122.33 }),
    // No spot: no pin, though it still counts as a place.
    visit({ visitor: "d", city: null, region: null, country: "CA", lat: null, lng: null }),
  ];
  assert.deepEqual(pins(rows), [
    { lat: 47.61, lng: -122.33, place: "Seattle, WA, US", visitors: 2, visits: 2 },
    { lat: 47.25, lng: -122.44, place: "Tacoma, WA, US", visitors: 1, visits: 2 },
  ]);
  assert.deepEqual(top(rows, placeName, 5), [
    { name: "Seattle, WA, US", count: 2 },
    { name: "CA", count: 1 },
    { name: "Tacoma, WA, US", count: 1 },
  ]);
  assert.equal(placeName({ city: null, region: null, country: null }), "Unknown place");
});

test("pages are counted by views, sources by visitors", () => {
  const rows = [visit({ visitor: "a", path: "/" }), visit({ visitor: "a", path: "/" }), visit({ visitor: "b", path: "/app" }), visit({ visitor: "a", referrer: "google.com" }), visit({ visitor: "a", referrer: "google.com" })];
  assert.deepEqual(top(rows, (r) => r.path, 1, false), [{ name: "/", count: 4 }]);
  assert.deepEqual(top(rows.filter((r) => r.referrer), (r) => r.referrer ?? "", 5), [{ name: "google.com", count: 1 }]);
});

test("the owner's visits go, with the pages they saw that day before signing in", () => {
  const rows = [visit({ visitor: "owner", path: "/" }), visit({ visitor: "owner", path: "/sign-in" }), visit({ visitor: "owner", path: "/app/admin", own: true }), visit({ visitor: "stranger" })];
  assert.deepEqual(withoutOwner(rows).map((r) => r.visitor), ["stranger"]);
  assert.equal(withoutOwner([visit({ visitor: "a" })]).length, 1);
});
