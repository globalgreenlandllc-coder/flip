import { test } from "node:test";
import assert from "node:assert/strict";
import { dealColumns } from "../deals.ts";
import type { Report } from "../engine/types.ts";

// What a saved deal keeps in the Deal table's columns (2026-11-28): the resale the deal was worked out on, so the
// card's margin (profit ÷ that column) is the result page's (profit ÷ deal.arv).

const report = (deal: Partial<Report["deal"]>, arvPoint = 515_140) =>
  ({ arv: { point: arvPoint }, deal: { verdict: "CHECK FIRST", purchasePrice: 245_000, arv: 493_587, maxAllowableOffer: 305_186, profit: 124_925, ...deal } }) as unknown as Report;

test("the arv column holds the resale after the plan, not the comps' fully renovated value", () => {
  const cols = dealColumns(report({}));
  assert.deepEqual(cols, { askingPrice: 245_000, verdict: "CHECK FIRST", arv: 493_587, maxOffer: 305_186, profit: 124_925 });
  // The card's margin and the result page's are the same figure.
  const r = report({});
  assert.equal(((cols!.profit / cols!.arv) * 100).toFixed(1), ((r.deal.profit / r.deal.arv) * 100).toFixed(1));
});

test("a report without a usable deal is not saved", () => {
  assert.equal(dealColumns(null), null);
  assert.equal(dealColumns({} as Report), null);
  assert.equal(dealColumns(report({ verdict: "MAYBE" as never })), null);
  assert.equal(dealColumns(report({ arv: Number.NaN })), null);
  assert.equal(dealColumns(report({ profit: Infinity })), null);
});
