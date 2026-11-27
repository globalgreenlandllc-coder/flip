import { test } from "node:test";
import assert from "node:assert/strict";
import { returnTo, withReturn } from "./return-to.ts";

const LINK = "/app/analyze?link=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F1-Main-St%2F1_zpid%2F";

test("a path on this site is handed on as it is", () => {
  assert.equal(returnTo(LINK, "www.renoflip.app"), LINK);
  assert.equal(returnTo("/app", "www.renoflip.app"), "/app");
  assert.equal(returnTo("/app/deals#top", null), "/app/deals#top");
});

test("a full address on this same host is turned into its path", () => {
  assert.equal(returnTo(`https://www.renoflip.app${LINK}`, "www.renoflip.app"), LINK);
  assert.equal(returnTo(`http://localhost:3417${LINK}`, "localhost:3417"), LINK);
  assert.equal(returnTo("https://WWW.RenoFlip.app/app", "www.renoflip.app"), "/app");
});

test("another site, or something that is not an address, is dropped", () => {
  for (const bad of [
    "https://evil.example/app",
    "https://www.renoflip.app.evil.example/app",
    "//evil.example/app",
    "/\\evil.example/app",
    "javascript:alert(1)",
    "data:text/html,hi",
    "app/analyze",
    "",
    7,
    null,
    undefined,
    `/${"a".repeat(2_001)}`,
  ]) {
    assert.equal(returnTo(bad, "www.renoflip.app"), null, String(bad).slice(0, 40));
  }
  // A full address with no host to compare with is not trusted.
  assert.equal(returnTo("https://www.renoflip.app/app", null), null);
});

test("the other sign page carries the place to return to", () => {
  assert.equal(withReturn("/sign-up", LINK), `/sign-up?redirect_url=${encodeURIComponent(LINK)}`);
  assert.equal(withReturn("/sign-in", null), "/sign-in");
});
