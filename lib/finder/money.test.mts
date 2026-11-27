import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "./money.ts";

test("money is read the way people type it, and what cannot be read is not guessed", () => {
  for (const [typed, value] of [["60000", 60_000], ["60,000", 60_000], ["$60,000", 60_000], [" 60k ", 60_000], ["60K", 60_000], ["75k", 75_000], ["1.5M", 1_500_000], ["1.5m", 1_500_000], ["250000", 250_000], ["0", 0]] as const) {
    assert.equal(parseMoney(typed), value, typed);
  }
  for (const typed of ["", "sixty", "60 thousand", "1.5.5", "-5", "60kk", "k", "$"]) assert.equal(parseMoney(typed), null, typed);
});
