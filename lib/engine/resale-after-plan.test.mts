import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate } from "./index.ts";
import type { PropertyFacts } from "./index.ts";
import { DEFAULT_RENOVATION_COSTS, planRenovation, type CategoryNeeds } from "./renovation.ts";
import { generateMarketData } from "./synthetic.ts";

// The resale the PLANNED work reaches (2026-11-28): the deal is worked out on it, not on the fully renovated value.

const subject: PropertyFacts = {
  id: "s", lat: 47.68, lng: -122.36, submarket: "98103", sqft: 1840, lotSqft: 5200,
  beds: 3, baths: 2, yearBuilt: 1952, garage: 1, condition: "dated",
};
const needs = (over: Partial<CategoryNeeds> = {}): CategoryNeeds => ({
  kitchen: "none", baths: "none", flooring: "none", paint: "none", exterior: "none", landscaping: "none",
  windows: "none", roof: "none", electrical: "none", plumbing: "none", hvac: "none", basement: "none", ...over,
});
const ARV = 1_000_000;
const base = { subject, currentCondition: "dated" as const, arvPoint: ARV, config: DEFAULT_MARKET_CONFIG };
const upliftOf = (plan: ReturnType<typeof planRenovation>) => plan.uplift;

test("a plan that brings every part below par up to par reaches the fully renovated value", () => {
  const plan = planRenovation({ ...base, ceiling: null, needs: needs({ kitchen: "replace", baths: "replace", flooring: "refresh", paint: "refresh", roof: "replace" }) });
  assert.deepEqual(plan.leftBelowPar, []);
  assert.equal(plan.fullValue, ARV);
  assert.equal(plan.afterPlanValue, ARV);
});

test("nothing below par: the resale after the plan is the fully renovated value", () => {
  const plan = planRenovation({ ...base, ceiling: null, needs: needs() });
  assert.equal(plan.afterPlanValue, ARV);
});

test("a part left as it is lowers the resale by exactly its share of the uplift", () => {
  // A kitchen so dear that neither a replace nor a refresh pays: the plan skips it.
  const costs = { ...DEFAULT_RENOVATION_COSTS, kitchen: { ...DEFAULT_RENOVATION_COSTS.kitchen, refresh: [900_000, 900_000] as [number, number], replace: [900_000, 900_000] as [number, number] } };
  const plan = planRenovation({ ...base, ceiling: null, costs, needs: needs({ kitchen: "replace", paint: "refresh" }) });
  const kitchen = plan.items.find((i) => i.key === "kitchen")!;
  assert.equal(kitchen.action, "skip");
  const share = DEFAULT_RENOVATION_COSTS.kitchen.share * upliftOf(plan);
  assert.deepEqual(plan.leftBelowPar, [{ key: "kitchen", label: "Kitchen", why: "skipped", lost: share }]);
  assert.ok(Math.abs(plan.afterPlanValue! - (ARV - share)) < 1e-6, `${plan.afterPlanValue} vs ${ARV - share}`);
  assert.ok(plan.afterPlanValue! < plan.fullValue!);
});

test("a refresh where a replace was needed lowers the resale by what the refresh does not capture", () => {
  // A dear replace and a cheap refresh: the planner picks the refresh.
  const costs = { ...DEFAULT_RENOVATION_COSTS, kitchen: { ...DEFAULT_RENOVATION_COSTS.kitchen, replace: [400_000, 400_000] as [number, number] } };
  const plan = planRenovation({ ...base, ceiling: null, costs, needs: needs({ kitchen: "replace" }) });
  const kitchen = plan.items.find((i) => i.key === "kitchen")!;
  assert.equal(kitchen.action, "refresh");
  const c = DEFAULT_RENOVATION_COSTS.kitchen;
  const lost = c.share * upliftOf(plan) * (1 - c.refreshCapture);
  assert.equal(plan.leftBelowPar![0].why, "refresh-only");
  assert.ok(Math.abs(plan.afterPlanValue! - (ARV - lost)) < 1e-6);
});

test("systems are always done, and parts not seen are counted as at par: neither lowers the resale", () => {
  const plan = planRenovation({ ...base, ceiling: null, needs: needs({ roof: "replace", electrical: "refresh", windows: "unknown", hvac: "unknown" }) });
  assert.deepEqual(plan.leftBelowPar, []);
  assert.equal(plan.afterPlanValue, ARV);
});

test("never above the fully renovated value, and never above a ceiling that caps", () => {
  for (const kitchen of ["none", "refresh", "replace"] as const) {
    for (const ceiling of [null, { pricePerSqft: 1, value: 950_000, sampleSize: 30, basis: "renovated" as const }]) {
      const plan = planRenovation({ ...base, ceiling, needs: needs({ kitchen, baths: "replace", flooring: "replace", windows: "replace" }) });
      assert.ok(plan.afterPlanValue! <= plan.fullValue! + 1e-6);
      assert.ok(plan.fullValue! <= ARV);
      if (ceiling) assert.ok(plan.afterPlanValue! <= ceiling.value + 1e-6);
    }
  }
});

test("a part skipped only because the block will not pay for it costs no resale: the ceiling is not taken off twice", () => {
  // Almost no headroom under the ceiling: the planner skips discretionary work, and the value stops at the ceiling.
  const asIs = (ARV / 1.12) * 0.9;
  const ceiling = { pricePerSqft: 1, value: asIs + 20_000, sampleSize: 30, basis: "renovated" as const };
  const plan = planRenovation({ ...base, ceiling, needs: needs({ kitchen: "replace", baths: "replace", flooring: "replace", exterior: "replace", windows: "replace" }) });
  assert.ok(plan.leftBelowPar!.length > 0, "something was skipped for the ceiling");
  assert.equal(plan.fullValue, ceiling.value);
  assert.equal(plan.afterPlanValue, ceiling.value);
});

test("the deal is worked out on the resale after the plan, and says so", () => {
  const market = generateMarketData({ seed: 7 });
  const asOf = "2026-09-01";
  const subject = market.subject;
  const full = evaluate({ subject, sales: market.sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 600_000, rehab: 80_000 } });
  assert.equal(full.deal.resaleBasis, "fully-renovated");
  assert.equal(full.deal.arv, full.arv.point);
  assert.equal(full.deal.fullyRenovated, full.arv.point);
  assert.ok(full.narrative.some((l) => l.startsWith("The deal uses the fully renovated value")));

  const lower = full.arv.point - 40_000;
  const planned = evaluate({ subject, sales: market.sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 600_000, rehab: 80_000 }, resale: { afterPlan: lower, leftBelowPar: [{ label: "Kitchen", why: "skipped", lost: 40_000 }] } });
  assert.equal(planned.deal.resaleBasis, "after-plan");
  assert.equal(planned.deal.arv, lower);
  assert.equal(planned.deal.fullyRenovated, full.arv.point);
  assert.equal(planned.arv.point, full.arv.point, "the comps' value itself is unchanged");
  // Selling costs scale with the resale, so profit falls by the resale difference less the selling-cost share of it.
  const expected = full.deal.profit - 40_000 * (1 - DEFAULT_DEAL_TERMS.closingSellPct);
  assert.ok(Math.abs(planned.deal.profit - expected) < 1e-6, `${planned.deal.profit} vs ${expected}`);
  assert.ok(planned.deal.maxAllowableOffer < full.deal.maxAllowableOffer);
  assert.ok(planned.narrative.some((l) => l.startsWith(`Resale after this plan $`) && l.includes("kitchen (left as it is)")));
  assert.ok(planned.narrative.some((l) => l.includes("all-in against resale after this plan")));

  // A plan value above the comps' (it cannot be) is held at the comps' value.
  const over = evaluate({ subject, sales: market.sales, asOf, config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 600_000, rehab: 80_000 }, resale: { afterPlan: full.arv.point + 1, leftBelowPar: [] } });
  assert.equal(over.deal.arv, full.arv.point);
});

test("Quick numbers, with or without a typed renovation, uses the fully renovated value and says so", () => {
  const market = generateMarketData({ seed: 11 });
  const subject = market.subject;
  for (const rehab of [undefined, 55_000]) {
    const r = evaluate({ subject, sales: market.sales, asOf: "2026-09-01", config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 600_000, ...(rehab === undefined ? {} : { rehab }) } });
    assert.equal(r.deal.resaleBasis, "fully-renovated");
    assert.equal(r.deal.arv, r.arv.point);
  }
});

// Review fixes (2026-11-28).

test("a part with no share of the uplift (the basement) is never listed, and brings up no ceiling", () => {
  for (const ceiling of [null, { pricePerSqft: 1, value: 1_132_684, sampleSize: 30, basis: "renovated" as const }]) {
    const plan = planRenovation({ ...base, ceiling, needs: needs({ basement: "replace", kitchen: "refresh" }) });
    assert.ok(!plan.leftBelowPar!.some((b) => b.key === "basement"), JSON.stringify(plan.leftBelowPar));
    assert.deepEqual(plan.leftBelowPar, []);
    assert.equal(plan.afterPlanValue, plan.fullValue);
  }
  const market = generateMarketData({ seed: 7 });
  const r = evaluate({ subject: market.subject, sales: market.sales, asOf: "2026-09-01", config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 600_000, rehab: 80_000 }, resale: { afterPlan: 2_000_000, leftBelowPar: [] } });
  assert.equal(r.deal.belowPar, "none");
  assert.ok(!r.narrative.some((l) => l.includes("ceiling stops the value")));
});

test("the parts listed always add up to the real gap (fully renovated less the resale after the plan), on 2,000 random plans", () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const NEEDS = ["none", "refresh", "replace", "unknown"] as const;
  const keys = Object.keys(DEFAULT_RENOVATION_COSTS) as (keyof CategoryNeeds)[];
  let binding = 0;
  for (let i = 0; i < 2_000; i++) {
    const n = Object.fromEntries(keys.map((k) => [k, NEEDS[Math.floor(rand() * 4)]])) as unknown as CategoryNeeds;
    const arvPoint = 300_000 + rand() * 900_000;
    const cond = (["distressed", "dated", "average", "updated"] as const)[Math.floor(rand() * 4)];
    const asIs = (arvPoint / 1.12) * (1 + DEFAULT_MARKET_CONFIG.conditionSteps[cond]);
    const ceiling = rand() < 0.5 ? null : { pricePerSqft: 1, value: asIs + rand() * (arvPoint - asIs) * 1.3, sampleSize: 30, basis: "renovated" as const };
    const plan = planRenovation({ subject, currentCondition: cond, arvPoint, config: DEFAULT_MARKET_CONFIG, ceiling, needs: n });
    const listed = plan.leftBelowPar!.reduce((s, b) => s + b.lost, 0);
    assert.ok(Math.abs(listed - (plan.fullValue! - plan.afterPlanValue!)) < 1e-6, `case ${i}: listed ${listed} vs gap ${plan.fullValue! - plan.afterPlanValue!}`);
    assert.ok(plan.leftBelowPar!.every((b) => b.lost >= 0 && b.key !== "basement"));
    assert.ok(plan.afterPlanValue! <= plan.fullValue! + 1e-6 && plan.fullValue! <= arvPoint + 1e-6);
    if (ceiling && ceiling.value < arvPoint) binding++;
  }
  assert.ok(binding > 100, `enough cases with a capping ceiling: ${binding}`);
});

test("when the ceiling caps the full value, each part's cost is scaled to the real gap, not its whole share", () => {
  // Kitchen left as it is (too dear), a ceiling a little under the comps' value: only part of the loss is real.
  const costs = { ...DEFAULT_RENOVATION_COSTS, kitchen: { ...DEFAULT_RENOVATION_COSTS.kitchen, refresh: [900_000, 900_000] as [number, number], replace: [900_000, 900_000] as [number, number] } };
  const ceiling = { pricePerSqft: 1, value: ARV - 20_000, sampleSize: 30, basis: "renovated" as const };
  const plan = planRenovation({ ...base, ceiling, costs, needs: needs({ kitchen: "replace" }) });
  const share = DEFAULT_RENOVATION_COSTS.kitchen.share * plan.uplift;
  assert.equal(plan.fullValue, ARV - 20_000);
  assert.ok(Math.abs(plan.afterPlanValue! - (ARV - share)) < 1e-6);
  assert.ok(Math.abs(plan.leftBelowPar![0].lost - (share - 20_000)) < 1e-6, `${plan.leftBelowPar![0].lost} vs ${share - 20_000}`);
});

test("the deal says what the plan leaves: none, absorbed by the ceiling, or a cost in resale", () => {
  const market = generateMarketData({ seed: 7 });
  const run = (afterPlan: number, left: { label: string; why: "skipped" | "refresh-only"; lost: number }[]) =>
    evaluate({ subject: market.subject, sales: market.sales, asOf: "2026-09-01", config: DEFAULT_MARKET_CONFIG, deal: { ...DEFAULT_DEAL_TERMS, askingPrice: 600_000, rehab: 80_000 }, resale: { afterPlan, leftBelowPar: left } });
  const full = run(9e9, []).arv.point;
  assert.equal(run(full, []).deal.belowPar, "none");
  const absorbed = run(full, [{ label: "Windows", why: "skipped", lost: 0 }]);
  assert.equal(absorbed.deal.belowPar, "absorbed");
  assert.ok(absorbed.narrative.some((l) => l.includes("the block's ceiling stops the value")));
  const costs = run(full - 30_000, [{ label: "Kitchen", why: "skipped", lost: 30_000 }]);
  assert.equal(costs.deal.belowPar, "costs");
  assert.ok(costs.narrative.some((l) => l.includes("not the fully renovated")));
  assert.ok(costs.deal.decidingFactor.includes("resale") && !costs.deal.decidingFactor.includes("ARV"), costs.deal.decidingFactor);
});
