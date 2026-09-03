import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKET_CONFIG } from "./index.ts";
import type { PropertyFacts } from "./index.ts";
import { planRenovation, type CategoryNeeds } from "./renovation.ts";

const subject: PropertyFacts = {
  id: "s", lat: 47.68, lng: -122.36, submarket: "98103", sqft: 1840, lotSqft: 5200,
  beds: 3, baths: 2, yearBuilt: 1952, garage: 1, condition: "dated",
};

const needs = (over: Partial<CategoryNeeds> = {}): CategoryNeeds => ({
  kitchen: "none", baths: "none", flooring: "none", paint: "none", exterior: "none", landscaping: "none",
  windows: "none", roof: "none", electrical: "none", plumbing: "none", hvac: "none", basement: "none", ...over,
});

test("dated house: kitchen, baths, flooring, paint get done; untouched categories are skipped", () => {
  const plan = planRenovation({
    subject, currentCondition: "dated", arvPoint: 1_000_000, ceiling: { pricePerSqft: 620, value: 1_140_800, sampleSize: 40 },
    config: DEFAULT_MARKET_CONFIG,
    needs: needs({ kitchen: "replace", baths: "replace", flooring: "replace", paint: "refresh", roof: "unknown" }),
  });
  const by = Object.fromEntries(plan.items.map((i) => [i.key, i]));
  assert.ok(by.kitchen.action === "replace" || by.kitchen.action === "refresh");
  assert.ok(by.kitchen.net > 0, `kitchen net ${by.kitchen.net}`);
  assert.equal(by.paint.action, "refresh");
  assert.equal(by.roof.action, "inspect");
  assert.equal(by.windows.action, "skip");
  assert.ok(plan.uplift > 0);
  assert.ok(plan.totals.valueAdded > plan.totals.costLikely, "plan should be net positive");
  assert.ok(plan.rehab.low <= plan.rehab.likely && plan.rehab.likely <= plan.rehab.high);
  assert.equal(plan.ceilingBinds, false);
  // Required/do items come before skips.
  const firstSkip = plan.items.findIndex((i) => i.action === "skip");
  const lastDo = plan.items.map((i) => i.action).lastIndexOf("replace");
  assert.ok(firstSkip === -1 || lastDo < firstSkip);
});

test("systems are required, not profit: net about zero", () => {
  const plan = planRenovation({
    subject, currentCondition: "average", arvPoint: 900_000, ceiling: null, config: DEFAULT_MARKET_CONFIG,
    needs: needs({ roof: "replace", electrical: "refresh" }),
  });
  const roof = plan.items.find((i) => i.key === "roof")!;
  assert.equal(roof.action, "required");
  assert.ok(Math.abs(roof.net) < 1);
  assert.ok(plan.rehab.likely >= roof.costLikely);
  assert.equal(plan.finishLevel, "mid");
});

test("ceiling binds: when the block will not pay, discretionary work is skipped and the advice says so", () => {
  // As-is value is right under the ceiling, so there is almost no headroom.
  const arv = 1_000_000;
  const asIs = arv / 1.12 * 0.9; // "dated" tier
  const plan = planRenovation({
    subject, currentCondition: "dated", arvPoint: arv,
    ceiling: { pricePerSqft: 1, value: asIs + 20_000, sampleSize: 30 },
    config: DEFAULT_MARKET_CONFIG,
    needs: needs({ kitchen: "replace", baths: "replace", flooring: "replace", exterior: "replace", windows: "replace" }),
  });
  assert.equal(plan.ceilingBinds, true);
  assert.equal(plan.finishLevel, "median");
  const skipped = plan.items.filter((i) => i.action === "skip" && /tops out/.test(i.reason));
  assert.ok(skipped.length >= 2, `expected ceiling skips, got ${skipped.length}`);
  assert.ok(plan.totals.valueAdded <= 20_000 + 1e-6);
});

test("replace vs refresh: picks the higher net option", () => {
  // Tiny uplift makes a full kitchen replace lose money; a refresh should win or both skip.
  const plan = planRenovation({
    subject, currentCondition: "updated", arvPoint: 500_000, ceiling: null, config: DEFAULT_MARKET_CONFIG,
    needs: needs({ kitchen: "replace" }),
  });
  const kitchen = plan.items.find((i) => i.key === "kitchen")!;
  assert.notEqual(kitchen.action, "replace");
});
