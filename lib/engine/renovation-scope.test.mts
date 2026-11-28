import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKET_CONFIG, REAL_SALES_CONFIG } from "./defaults.ts";
import type { Condition, PropertyFacts } from "./types.ts";
import { DEFAULT_RENOVATION_COSTS, advisedChoices, planRenovation, renovationBasis, scopePlan, type CategoryKey, type CategoryNeeds, type Need, type RenovationInput } from "./renovation.ts";
import { planRenovationBefore } from "./renovation-reference.mts";

// A small seeded random source, so a failure can be run again.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const KEYS = Object.keys(DEFAULT_RENOVATION_COSTS) as CategoryKey[];
const NEEDS: Need[] = ["none", "refresh", "replace", "unknown"];
const CONDITIONS: Condition[] = ["distressed", "dated", "average", "updated", "renovated"];

function randomInput(r: () => number): RenovationInput {
  const needs = Object.fromEntries(KEYS.map((k) => [k, NEEDS[Math.floor(r() * NEEDS.length)]])) as unknown as CategoryNeeds;
  const arvPoint = 250_000 + r() * 1_200_000;
  const condition = CONDITIONS[Math.floor(r() * CONDITIONS.length)];
  const roll = r();
  // No ceiling, one far above, or one near or under the as-is value: the ceiling loop takes every path.
  const ceiling = roll < 0.3 ? null : { pricePerSqft: 500, value: arvPoint * (roll < 0.55 ? 1.3 : 0.8 + r() * 0.35), sampleSize: 20, basis: (r() < 0.5 ? "renovated" : "all") as "renovated" | "all" };
  const subject: PropertyFacts = { id: "s", lat: 47.6, lng: -122.3, submarket: "98103", sqft: Math.round(700 + r() * 3_300), lotSqft: 5_000, beds: 3, baths: r() < 0.2 ? null : 1 + Math.floor(r() * 4), yearBuilt: 1960, garage: 1, condition };
  return { subject, currentCondition: condition, needs, arvPoint, ceiling, config: r() < 0.5 ? DEFAULT_MARKET_CONFIG : REAL_SALES_CONFIG };
}

test("the refactored planner gives the identical plan the old one did, over 20,000 generated houses", () => {
  const r = rng(20261128);
  for (let n = 0; n < 20_000; n++) {
    const input = randomInput(r);
    const { basis, ...now } = planRenovation(input);
    assert.ok(basis, "the plan keeps its basis");
    assert.deepEqual(now, planRenovationBefore(input), `house ${n}`);
  }
});

test("the advised scope chosen by hand (the plan's final options) prices the same as the analysis", () => {
  const r = rng(7);
  for (let n = 0; n < 5_000; n++) {
    const input = randomInput(r);
    const plan = planRenovation(input);
    const basis = renovationBasis(input);
    // The plan's final options: what the ceiling or a negative net skipped is chosen as "skip".
    const choices = Object.fromEntries(plan.items.filter((i) => i.action === "skip" || i.action === "refresh" || i.action === "replace").map((i) => [i.key, i.action])) as Record<CategoryKey, "skip" | "refresh" | "replace">;
    const chosen = scopePlan(basis, choices, { mode: "chosen" });
    assert.ok(Math.abs(chosen.afterPlanValue! - plan.afterPlanValue!) < 0.01, `house ${n}: resale ${chosen.afterPlanValue} vs ${plan.afterPlanValue}`);
    assert.ok(Math.abs(chosen.rehab.likely - plan.rehab.likely) < 0.01, `house ${n}: cost`);
    assert.ok(Math.abs(chosen.totals.valueAdded - plan.totals.valueAdded) < 0.01, `house ${n}: value added`);
  }
});

test("advisedChoices is the analysis' own pick before the ceiling", () => {
  const r = rng(99);
  for (let n = 0; n < 2_000; n++) {
    const input = randomInput(r);
    const basis = renovationBasis(input);
    const advised = advisedChoices(basis);
    const plan = scopePlan(basis, advised, { mode: "advise" });
    assert.deepEqual(plan.items, planRenovation(input).items);
  }
});
