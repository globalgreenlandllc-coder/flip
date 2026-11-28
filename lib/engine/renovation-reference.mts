/**
 * TEST FIXTURE ONLY: the renovation planner as it was before Deal Studio's advisor (origin/main a07e12f), kept so a
 * test can prove the refactored planRenovation (basis + advisedChoices + scopePlan) gives the identical plan
 * (renovation-scope.test.mts). Not used by the app.
 */
import type { PropertyFacts } from "./types";
import { DEFAULT_RENOVATION_COSTS, type BelowPar, type CategoryCost, type CategoryKey, type PlanAction, type PlanItem, type RenovationInput, type RenovationPlan } from "./renovation";

const MAJOR: CategoryKey[] = ["kitchen", "baths", "roof", "electrical", "plumbing", "hvac"];





/**
 * A house whose bathroom count nobody gave is priced as having two, and its line in the plan says
 * so. One would be the least it can have, and the least is the number that flatters the deal.
 */
const BATHS_WHEN_UNKNOWN = 2;

function unitCost(range: [number, number], unit: CategoryCost["unit"], subject: PropertyFacts, key: CategoryKey): [number, number] {
  // Windows "replace" is priced per sqft of living area; its "refresh" is flat.
  const perSqft = unit === "sqft" || (key === "windows" && range[0] < 100);
  const mult = perSqft ? subject.sqft : unit === "bath" ? Math.max(1, subject.baths ?? BATHS_WHEN_UNKNOWN) : 1;
  return [range[0] * mult, range[1] * mult];
}

function mid([lo, hi]: [number, number]): number {
  return (lo + hi) / 2;
}

export function planRenovationBefore(input: RenovationInput): RenovationPlan {
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
    const make = (action: PlanAction, cost: [number, number], valueAdded: number, why: string): PlanItem => {
      const costLikely = mid(cost);
      const net = valueAdded - costLikely;
      // A cost that rests on an assumed number of bathrooms says so on its own line.
      const reason = c.unit === "bath" && subject.baths === null && costLikely > 0 ? `${why} The number of bathrooms is not known: priced as ${BATHS_WHEN_UNKNOWN}.` : why;
      return { key, label: c.label, need, action, costLow: cost[0], costLikely, costHigh: cost[1], valueAdded, net, roi: costLikely > 0 ? net / costLikely : NaN, reason };
    };

    if (need === "none") {
      items.push(make("skip", [0, 0], 0, "Already at par for the block. Don't touch it."));
      continue;
    }
    if (need === "unknown") {
      if (MAJOR.includes(key)) {
        items.push(make("inspect", refresh, 0, "Not in the photos. Budgeted as a refresh until you see it; a $0 line here would flatter the deal."));
      } else {
        items.push(make("inspect", [0, 0], 0, "Not visible in the photos. Verify on the walkthrough; the hidden-risk reserve covers surprises."));
      }
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

  // The resale the planned work reaches. The comps value the house as renovated, every part at par. A part the
  // photos show below par that the plan leaves as it is does not earn its share of the uplift, and a refresh where a
  // full replace was needed earns only what a refresh captures. Systems are always done (required), and parts already
  // at par or not seen are counted as at par, as the comps value assumes. The ceiling caps the result where it
  // applies, so a part skipped only because the block would not pay for it costs nothing: the ceiling already stops
  // the value there, and it is not taken off twice.
  const belowPar: BelowPar[] = [];
  for (const item of items) {
    const c = costs[item.key];
    if (c.system || (item.need !== "refresh" && item.need !== "replace")) continue;
    const share = c.share * uplift;
    let lost = 0;
    if (item.action === "skip") lost = share;
    else if (item.need === "replace" && item.action === "refresh") lost = share * (1 - c.refreshCapture);
    // A part with no share of the uplift (the basement) costs no resale to leave: it is not listed.
    if (lost > 0) belowPar.push({ key: item.key, label: c.label, why: item.action === "skip" ? "skipped" : "refresh-only", lost });
  }
  const cap = ceiling ? ceiling.value : Number.POSITIVE_INFINITY;
  const fullValue = Math.min(arvPoint, cap);
  const shortfall = belowPar.reduce((s, b) => s + b.lost, 0);
  const afterPlanValue = Math.min(arvPoint - shortfall, cap);
  // Where the ceiling caps, part or all of what the plan leaves below par lies above what the block pays anyway: each
  // part's cost in resale is scaled to the real gap, so the parts listed add up to fullValue − afterPlanValue (all of
  // them $0 when the ceiling absorbs the whole of it).
  // (No ceiling under the comps' value: the gap is the shortfall itself, scale exactly 1.)
  const scale = cap >= arvPoint ? 1 : shortfall > 0 ? (fullValue - afterPlanValue) / shortfall : 0;
  const leftBelowPar = belowPar.map((b) => ({ ...b, lost: b.lost * scale }));

  const doing = items.filter((i) => i.action === "replace" || i.action === "refresh" || i.action === "required" || (i.action === "inspect" && i.costLikely > 0));
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
    afterPlanValue,
    fullValue,
    leftBelowPar,
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
