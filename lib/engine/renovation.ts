import type { CeilingResult, Condition, MarketConfig, PropertyFacts, RehabRange } from "./types";

/**
 * Renovation ROI model. Turns a photo assessment (what each category needs)
 * into a ranked plan: what to do, what to skip, and why, constrained by the
 * neighborhood ceiling so the plan never over-improves the block.
 *
 * Value logic: bringing a house from its current condition tier to
 * "renovated" is worth (ARV - as-is value). Buyers attribute that uplift to
 * categories in known proportions (kitchen first, then baths, ...). A
 * category only earns its share if it is currently below par. Systems
 * (roof, electrical, plumbing, HVAC) do not add value: they avoid the
 * inspection discount, so they are "required", not "profit".
 */

export type Need = "none" | "refresh" | "replace" | "unknown";

export interface CategoryNeeds {
  kitchen: Need;
  baths: Need;
  flooring: Need;
  paint: Need;
  exterior: Need;
  landscaping: Need;
  windows: Need;
  roof: Need;
  electrical: Need;
  plumbing: Need;
  hvac: Need;
  basement: Need;
}

export type CategoryKey = keyof CategoryNeeds;

export interface CategoryCost {
  label: string;
  /** [low, high] per unit. */
  refresh: [number, number];
  replace: [number, number];
  unit: "flat" | "sqft" | "bath";
  /** Share of the renovated-condition uplift buyers attribute to this category. Shares sum to 1. */
  share: number;
  /** Fraction of the share a refresh captures when a full replace is what's needed. */
  refreshCapture: number;
  /** Systems avoid a discount rather than add value. */
  system: boolean;
}

/**
 * PLACEHOLDER unit costs at flipper-contractor rates (not retail), roughly
 * Seattle 2026. Calibrate per metro from real job costs before selling reports.
 */
export const DEFAULT_RENOVATION_COSTS: Record<CategoryKey, CategoryCost> = {
  kitchen: { label: "Kitchen", refresh: [8_000, 15_000], replace: [25_000, 45_000], unit: "flat", share: 0.3, refreshCapture: 0.45, system: false },
  baths: { label: "Bathrooms", refresh: [3_000, 6_000], replace: [10_000, 18_000], unit: "bath", share: 0.2, refreshCapture: 0.45, system: false },
  flooring: { label: "Flooring", refresh: [3, 5], replace: [6, 9], unit: "sqft", share: 0.12, refreshCapture: 0.6, system: false },
  paint: { label: "Interior paint", refresh: [2.5, 4], replace: [2.5, 4], unit: "sqft", share: 0.1, refreshCapture: 1, system: false },
  exterior: { label: "Exterior / curb appeal", refresh: [6_000, 12_000], replace: [25_000, 45_000], unit: "flat", share: 0.1, refreshCapture: 0.55, system: false },
  landscaping: { label: "Landscaping", refresh: [2_000, 5_000], replace: [6_000, 12_000], unit: "flat", share: 0.04, refreshCapture: 0.6, system: false },
  windows: { label: "Windows", refresh: [1_500, 3_000], replace: [8, 14], unit: "flat", share: 0.05, refreshCapture: 0.3, system: false },
  roof: { label: "Roof", refresh: [1_500, 4_000], replace: [12_000, 25_000], unit: "flat", share: 0.03, refreshCapture: 0.5, system: true },
  electrical: { label: "Electrical", refresh: [1_500, 3_000], replace: [3_000, 6_000], unit: "flat", share: 0.02, refreshCapture: 0.5, system: true },
  plumbing: { label: "Plumbing", refresh: [2_000, 4_000], replace: [8_000, 15_000], unit: "flat", share: 0.02, refreshCapture: 0.5, system: true },
  hvac: { label: "Heating / cooling", refresh: [500, 1_500], replace: [8_000, 15_000], unit: "flat", share: 0.02, refreshCapture: 0.5, system: true },
  basement: { label: "Basement", refresh: [5_000, 12_000], replace: [20_000, 40_000], unit: "flat", share: 0, refreshCapture: 0.5, system: false },
};

export type PlanAction = "replace" | "refresh" | "required" | "inspect" | "skip";

export interface PlanItem {
  key: CategoryKey;
  label: string;
  need: Need;
  action: PlanAction;
  costLow: number;
  costLikely: number;
  costHigh: number;
  valueAdded: number;
  net: number;
  /** net / costLikely. NaN when there is no cost. */
  roi: number;
  reason: string;
}

export interface RenovationPlan {
  /** Value of the house in its current condition. */
  asIsValue: number;
  /** ARV - as-is: the most any renovation can add. */
  uplift: number;
  /** Ceiling - as-is: what the block will actually pay for. Infinity when unknown. */
  headroom: number;
  ceilingBinds: boolean;
  finishLevel: "median" | "mid" | "mid-high";
  finishAdvice: string;
  items: PlanItem[];
  totals: { costLow: number; costLikely: number; costHigh: number; valueAdded: number; net: number };
  /** What to feed the deal: cost of every do + required item. */
  rehab: RehabRange;
}

export interface RenovationInput {
  subject: PropertyFacts;
  currentCondition: Condition;
  needs: CategoryNeeds;
  arvPoint: number;
  ceiling: CeilingResult | null;
  config: MarketConfig;
  costs?: Record<CategoryKey, CategoryCost>;
}

function unitCost(range: [number, number], unit: CategoryCost["unit"], subject: PropertyFacts, key: CategoryKey): [number, number] {
  // Windows "replace" is priced per sqft of living area; its "refresh" is flat.
  const perSqft = unit === "sqft" || (key === "windows" && range[0] < 100);
  const mult = perSqft ? subject.sqft : unit === "bath" ? Math.max(1, subject.baths) : 1;
  return [range[0] * mult, range[1] * mult];
}

function mid([lo, hi]: [number, number]): number {
  return (lo + hi) / 2;
}

export function planRenovation(input: RenovationInput): RenovationPlan {
  const { subject, currentCondition, needs, arvPoint, ceiling, config } = input;
  const costs = input.costs ?? DEFAULT_RENOVATION_COSTS;
  const steps = config.conditionSteps;

  const base = arvPoint / (1 + steps.renovated);
  const asIsValue = base * (1 + steps[currentCondition]);
  const uplift = Math.max(0, arvPoint - asIsValue);
  const headroom = ceiling ? Math.max(0, ceiling.value - asIsValue) : Number.POSITIVE_INFINITY;

  const items: PlanItem[] = [];

  for (const key of Object.keys(costs) as CategoryKey[]) {
    const c = costs[key];
    const need = needs[key] ?? "unknown";
    const refresh = unitCost(c.refresh, c.unit, subject, key);
    const replace = unitCost(c.replace, c.unit, subject, key);
    const make = (action: PlanAction, cost: [number, number], valueAdded: number, reason: string): PlanItem => {
      const costLikely = mid(cost);
      const net = valueAdded - costLikely;
      return { key, label: c.label, need, action, costLow: cost[0], costLikely, costHigh: cost[1], valueAdded, net, roi: costLikely > 0 ? net / costLikely : NaN, reason };
    };

    if (need === "none") {
      items.push(make("skip", [0, 0], 0, "Already at par for the block. Don't touch it."));
      continue;
    }
    if (need === "unknown") {
      items.push(make("inspect", [0, 0], 0, "Not visible in the photos. Verify on the walkthrough; the hidden-risk reserve covers surprises."));
      continue;
    }
    if (c.system) {
      const cost = need === "replace" ? replace : refresh;
      items.push(make("required", cost, mid(cost), need === "replace"
        ? "Buyers and inspectors discount a failing system at 1.5–2× its cost. This is a condition of sale, not a profit item."
        : "Service and make presentable so it does not become an inspection negotiation."));
      continue;
    }

    const fullValue = c.share * uplift;
    if (need === "refresh") {
      items.push(make("refresh", refresh, fullValue, "A refresh brings this to par for the block; a full replace would not earn more."));
      continue;
    }
    // need === "replace": compare a full replace against a cheaper refresh.
    const replaceItem = make("replace", replace, fullValue, "Below par and buyers price it first. Full replace at mid-grade finish.");
    const refreshItem = make("refresh", refresh, fullValue * c.refreshCapture, "Full replace does not pay here; a refresh captures most of the value at a fraction of the cost.");
    items.push(replaceItem.net >= refreshItem.net ? replaceItem : refreshItem);
  }

  // Ceiling cap: discretionary value is realized in ROI order until the block stops paying.
  let ceilingBinds = false;
  const discretionary = items
    .filter((i) => i.action === "replace" || i.action === "refresh")
    .sort((a, b) => b.roi - a.roi);
  let remaining = headroom;
  for (const item of discretionary) {
    const allowed = Math.max(0, Math.min(item.valueAdded, remaining));
    if (allowed < item.valueAdded) {
      ceilingBinds = true;
      item.valueAdded = allowed;
      item.net = allowed - item.costLikely;
      item.roi = item.costLikely > 0 ? item.net / item.costLikely : NaN;
      if (item.net <= 0) {
        item.action = "skip";
        item.reason = `The block tops out near $${Math.round(ceiling!.value).toLocaleString("en-US")}. This spend would not come back. Leave it clean and functional.`;
        item.costLow = 0;
        item.costLikely = 0;
        item.costHigh = 0;
        item.valueAdded = 0;
        item.net = 0;
        item.roi = NaN;
        continue;
      }
    }
    remaining -= allowed;
  }
  // Anything discretionary that is still net-negative after all that is a skip too.
  for (const item of items) {
    if ((item.action === "replace" || item.action === "refresh") && item.net < 0) {
      item.action = "skip";
      item.reason = "Costs more than it adds here. Skip.";
      item.costLow = item.costLikely = item.costHigh = 0;
      item.valueAdded = item.net = 0;
      item.roi = NaN;
    }
  }

  const doing = items.filter((i) => i.action === "replace" || i.action === "refresh" || i.action === "required");
  const totals = {
    costLow: doing.reduce((s, i) => s + i.costLow, 0),
    costLikely: doing.reduce((s, i) => s + i.costLikely, 0),
    costHigh: doing.reduce((s, i) => s + i.costHigh, 0),
    valueAdded: doing.reduce((s, i) => s + i.valueAdded, 0),
    net: doing.reduce((s, i) => s + i.net, 0),
  };

  const headroomPct = ceiling ? (ceiling.value - arvPoint) / arvPoint : null;
  let finishLevel: RenovationPlan["finishLevel"];
  let finishAdvice: string;
  if (headroomPct === null) {
    finishLevel = "mid";
    finishAdvice = "Ceiling unknown for this submarket. Stay at a mid-grade finish until comps prove the block pays for more.";
  } else if (headroomPct < 0.05) {
    finishLevel = "median";
    finishAdvice = "This house already sits at the top of its block. Hit the median finish level, keep it clean, and sell fast. Premium finishes will not be repaid.";
  } else if (headroomPct < 0.15) {
    finishLevel = "mid";
    finishAdvice = "Some headroom under the ceiling. Mid-grade finishes, no custom work.";
  } else {
    finishLevel = "mid-high";
    finishAdvice = "The block clears well above this ARV. Mid-high finishes in the kitchen and primary bath are likely to be repaid.";
  }

  // Order: required first, then do-items by net, then inspect, then skips.
  const order: Record<PlanAction, number> = { required: 0, replace: 1, refresh: 1, inspect: 2, skip: 3 };
  items.sort((a, b) => order[a.action] - order[b.action] || b.net - a.net);

  return {
    asIsValue,
    uplift,
    headroom,
    ceilingBinds,
    finishLevel,
    finishAdvice,
    items,
    totals,
    rehab: { low: totals.costLow, likely: totals.costLikely, high: totals.costHigh },
  };
}
