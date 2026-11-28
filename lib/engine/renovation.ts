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

/** Categories that decide a flip's budget. Unseen, they are budgeted as a refresh until inspected. */
const MAJOR: CategoryKey[] = ["kitchen", "baths", "roof", "electrical", "plumbing", "hvac"];

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

/** A part the plan leaves below par, and the resale that costs (2026-11-28). */
export interface BelowPar {
  key: CategoryKey;
  label: string;
  /** "skipped": left as it is. "refresh-only": refreshed where a full replace was needed. */
  why: "skipped" | "refresh-only";
  /** Resale not reached because of it: the part's whole share of the uplift, or what a refresh does not capture. */
  lost: number;
}

/** What a line of the plan can be set to in Deal Studio's advisor: left as it is, refreshed, or replaced. */
export type ScopeOption = "skip" | "refresh" | "replace";

/** The option chosen for each line that can be chosen (lines left out keep the advised option). */
export type ScopeChoices = Partial<Record<CategoryKey, ScopeOption>>;

/**
 * What a plan is worked out from (2026-11-28, Deal Studio's advisor): kept with the plan so the browser can price
 * other scopes of the same house with the same arithmetic, without the server, the AI or a data provider. Plain
 * numbers only (it travels as JSON: no Infinity).
 */
export interface RenovationBasis {
  /** The comps' value the plan starts from (uncapped: the ceiling is applied by the plan). */
  arvPoint: number;
  asIsValue: number;
  uplift: number;
  /** The block's ceiling, where one applies; null when none does. */
  cap: number | null;
  sqft: number;
  baths: number | null;
  needs: CategoryNeeds;
}

export interface RenovationPlan {
  /** How the plan was worked out, for pricing other scopes (absent on plans saved before 2026-11-28). */
  basis?: RenovationBasis;
  /**
   * The resale value the PLANNED work reaches: the comps' fully renovated value less what the plan leaves below par
   * (leftBelowPar), never above the block's ceiling where it applies. This is the value the deal is worked out on.
   * Absent on plans saved before 2026-11-28.
   */
  afterPlanValue?: number;
  /** The comps' fully renovated value, capped by the ceiling where it applies: what afterPlanValue is when nothing is left below par. */
  fullValue?: number;
  /**
   * What the plan leaves below par, each with the resale it costs; the costs add up to fullValue − afterPlanValue, so
   * where the ceiling absorbs a loss the part is listed with less (or $0). Empty when every part the photos show below
   * par that carries value is brought to par.
   */
  leftBelowPar?: BelowPar[];
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

/**
 * A house whose bathroom count nobody gave is priced as having two, and its line in the plan says
 * so. One would be the least it can have, and the least is the number that flatters the deal.
 */
const BATHS_WHEN_UNKNOWN = 2;

function unitCost(range: [number, number], unit: CategoryCost["unit"], house: { sqft: number; baths: number | null }, key: CategoryKey): [number, number] {
  // Windows "replace" is priced per sqft of living area; its "refresh" is flat.
  const perSqft = unit === "sqft" || (key === "windows" && range[0] < 100);
  const mult = perSqft ? house.sqft : unit === "bath" ? Math.max(1, house.baths ?? BATHS_WHEN_UNKNOWN) : 1;
  return [range[0] * mult, range[1] * mult];
}

function mid([lo, hi]: [number, number]): number {
  return (lo + hi) / 2;
}

/** What the plan of this house is worked out from: the as-is value, the uplift the comps allow, the ceiling. */
export function renovationBasis(input: RenovationInput): RenovationBasis {
  const { subject, currentCondition, needs, arvPoint, ceiling, config } = input;
  const steps = config.conditionSteps;
  const base = arvPoint / (1 + steps.renovated);
  const asIsValue = base * (1 + steps[currentCondition]);
  const uplift = Math.max(0, arvPoint - asIsValue);
  return { arvPoint, asIsValue, uplift, cap: ceiling ? ceiling.value : null, sqft: subject.sqft, baths: subject.baths, needs };
}

/** A line's two priced options, for this house. */
function lineCosts(basis: RenovationBasis, key: CategoryKey, costs: Record<CategoryKey, CategoryCost>): { refresh: [number, number]; replace: [number, number] } {
  const c = costs[key];
  return { refresh: unitCost(c.refresh, c.unit, basis, key), replace: unitCost(c.replace, c.unit, basis, key) };
}

/**
 * Whether a line can be chosen in the advisor: a part the photos show (at par or below), that is not a system. Systems
 * are required, and a part the photos do not show is budgeted until it is seen: neither can be switched off.
 */
export function isChoiceLine(key: CategoryKey, need: Need, costs: Record<CategoryKey, CategoryCost> = DEFAULT_RENOVATION_COSTS): boolean {
  return !costs[key].system && need !== "unknown";
}

/**
 * The option the analysis picks for each line that needs work, before the block's ceiling is applied: a refresh where a
 * refresh brings it to par; where a full replace is needed, whichever of replace or refresh nets more.
 */
export function advisedChoices(basis: RenovationBasis, costs: Record<CategoryKey, CategoryCost> = DEFAULT_RENOVATION_COSTS): ScopeChoices {
  const out: ScopeChoices = {};
  for (const key of Object.keys(costs) as CategoryKey[]) {
    const c = costs[key];
    const need = basis.needs[key] ?? "unknown";
    if (c.system || (need !== "refresh" && need !== "replace")) continue;
    if (need === "refresh") {
      out[key] = "refresh";
      continue;
    }
    const { refresh, replace } = lineCosts(basis, key, costs);
    const fullValue = c.share * basis.uplift;
    out[key] = fullValue - mid(replace) >= fullValue * c.refreshCapture - mid(refresh) ? "replace" : "refresh";
  }
  return out;
}

/**
 * The plan for a scope of the house. "advise": the analysis' own rules — the block's ceiling and a negative net turn a
 * line into a skip. "chosen": the person's choices are kept as chosen (the ceiling still caps what a line adds, but
 * nothing chosen is dropped), for Deal Studio's advisor. The value side never depends on a cost the person types:
 * only on the options (renovation.ts' own costs order the ceiling).
 */
export function scopePlan(basis: RenovationBasis, choices: ScopeChoices, opts: { mode: "advise" | "chosen"; costs?: Record<CategoryKey, CategoryCost> }): RenovationPlan {
  const costs = opts.costs ?? DEFAULT_RENOVATION_COSTS;
  const advise = opts.mode === "advise";
  const { asIsValue, uplift } = basis;
  const headroom = basis.cap !== null ? Math.max(0, basis.cap - asIsValue) : Number.POSITIVE_INFINITY;

  const items: PlanItem[] = [];

  for (const key of Object.keys(costs) as CategoryKey[]) {
    const c = costs[key];
    const need = basis.needs[key] ?? "unknown";
    const { refresh, replace } = lineCosts(basis, key, costs);
    const make = (action: PlanAction, cost: [number, number], valueAdded: number, why: string): PlanItem => {
      const costLikely = mid(cost);
      const net = valueAdded - costLikely;
      // A cost that rests on an assumed number of bathrooms says so on its own line.
      const reason = c.unit === "bath" && basis.baths === null && costLikely > 0 ? `${why} The number of bathrooms is not known: priced as ${BATHS_WHEN_UNKNOWN}.` : why;
      return { key, label: c.label, need, action, costLow: cost[0], costLikely, costHigh: cost[1], valueAdded, net, roi: costLikely > 0 ? net / costLikely : NaN, reason };
    };
    const chosen = choices[key];

    if (need === "none") {
      if (advise || !chosen || chosen === "skip") items.push(make("skip", [0, 0], 0, "Already at par for the block. Don't touch it."));
      else items.push(make(chosen, chosen === "replace" ? replace : refresh, 0, "Already at par for the block: this spend adds nothing the comps would pay for."));
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
    if (advise) {
      if (need === "refresh") {
        items.push(make("refresh", refresh, fullValue, "A refresh brings this to par for the block; a full replace would not earn more."));
        continue;
      }
      // need === "replace": compare a full replace against a cheaper refresh.
      const replaceItem = make("replace", replace, fullValue, "Below par and buyers price it first. Full replace at mid-grade finish.");
      const refreshItem = make("refresh", refresh, fullValue * c.refreshCapture, "Full replace does not pay here; a refresh captures most of the value at a fraction of the cost.");
      items.push(choices[key] === "refresh" ? refreshItem : choices[key] === "replace" ? replaceItem : replaceItem.net >= refreshItem.net ? replaceItem : refreshItem);
      continue;
    }
    // The person's choice for a part the photos show below par.
    const option = chosen ?? (need === "refresh" ? "refresh" : "replace");
    if (option === "skip") {
      items.push(make("skip", [0, 0], 0, "Left as it is: it stays below par, and the resale counts that."));
    } else if (need === "refresh") {
      items.push(option === "refresh"
        ? make("refresh", refresh, fullValue, "A refresh brings this to par for the block; a full replace would not earn more.")
        : make("replace", replace, fullValue, "A full replace where a refresh brings it to par: it costs more and adds no more."));
    } else {
      items.push(option === "replace"
        ? make("replace", replace, fullValue, "Below par and buyers price it first. Full replace at mid-grade finish.")
        : make("refresh", refresh, fullValue * c.refreshCapture, "A refresh where a full replace is needed: it earns part of the value and the part stays below par."));
    }
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
      if (advise && item.net <= 0) {
        item.action = "skip";
        item.reason = `The block tops out near $${Math.round(basis.cap!).toLocaleString("en-US")}. This spend would not come back. Leave it clean and functional.`;
        item.costLow = 0;
        item.costLikely = 0;
        item.costHigh = 0;
        item.valueAdded = 0;
        item.net = 0;
        item.roi = NaN;
        continue;
      }
      if (!advise) item.reason = `${item.reason} The block tops out near $${Math.round(basis.cap!).toLocaleString("en-US")}, so it adds ${allowed > 0 ? `only $${Math.round(allowed).toLocaleString("en-US")}` : "nothing"} here.`;
    }
    remaining -= allowed;
  }
  // Anything discretionary that is still net-negative after all that is a skip too (the analysis' rule; a person's
  // own choice is kept as chosen).
  if (advise) {
    for (const item of items) {
      if ((item.action === "replace" || item.action === "refresh") && item.net < 0) {
        item.action = "skip";
        item.reason = "Costs more than it adds here. Skip.";
        item.costLow = item.costLikely = item.costHigh = 0;
        item.valueAdded = item.net = 0;
        item.roi = NaN;
      }
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
  const arvPoint = basis.arvPoint;
  const cap = basis.cap !== null ? basis.cap : Number.POSITIVE_INFINITY;
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

  const headroomPct = basis.cap !== null ? (basis.cap - arvPoint) / arvPoint : null;
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

/** The analysis' plan for the house: its basis, the advised options, the analysis' rules. */
export function planRenovation(input: RenovationInput): RenovationPlan {
  const costs = input.costs ?? DEFAULT_RENOVATION_COSTS;
  const basis = renovationBasis(input);
  return { basis, ...scopePlan(basis, advisedChoices(basis, costs), { mode: "advise", costs }) };
}
