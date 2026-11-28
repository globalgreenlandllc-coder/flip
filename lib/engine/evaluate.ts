import type { CompCriteria, DealInputs, MarketConfig, PropertyFacts, Report, RiskFlag, Sale } from "./types";
import { estimateArv } from "./arv";
import { RELAXATION_TIERS } from "./comps";
import { evaluateDeal, fmt } from "./deal";
import { rehabFromCondition } from "./rehab";

export interface EvaluateOptions {
  subject: PropertyFacts;
  sales: Sale[];
  asOf: string;
  config: MarketConfig;
  /** Deal inputs. If rehab is omitted, the condition-tier estimate is used. */
  deal: Omit<DealInputs, "rehab"> & { rehab?: number };
  /** The search tiers to widen through. Default: the demo's four. */
  tiers?: CompCriteria[];
  /**
   * The resale value the deal is worked out on, when a renovation plan says what its work reaches
   * (lib/engine/renovation.ts afterPlanValue). Without it the deal uses the comps' fully renovated value, the work
   * taken as bringing the house up to the renovated homes it is compared with.
   */
  resale?: { afterPlan: number; leftBelowPar: { label: string; why: "skipped" | "refresh-only"; lost: number }[] };
}

const DEFAULT_MAX_RENOVATION_SPREAD = 0.15;
/** A newest comparable sale older than this is said out loud: the market may have moved since. */
const STALE_AFTER_MONTHS = 4;

const monthOf = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function evaluate(opts: EvaluateOptions): Report {
  const { subject, sales, asOf, config } = opts;
  const tiers = opts.tiers ?? RELAXATION_TIERS;
  const arv = estimateArv(subject, sales, asOf, config, { tiers });
  const rehab = rehabFromCondition(subject.condition, subject.sqft, config);
  const dealInputs: DealInputs = { ...opts.deal, rehab: opts.deal.rehab ?? rehab.likely };
  // The value the deal is worked out on: what the planned work reaches, or else the fully renovated value.
  const afterPlan = opts.resale && Number.isFinite(opts.resale.afterPlan) && Number.isFinite(arv.point) ? Math.min(opts.resale.afterPlan, arv.point) : null;
  const deal = evaluateDeal(afterPlan ?? arv.point, dealInputs);
  deal.resaleBasis = afterPlan !== null ? "after-plan" : "fully-renovated";
  deal.fullyRenovated = arv.point;
  if (afterPlan !== null) {
    const left = opts.resale!.leftBelowPar;
    deal.belowPar = left.length === 0 ? "none" : afterPlan >= arv.point ? "absorbed" : "costs";
  }
  const resaleName = afterPlan !== null ? "resale after this plan" : "the fully renovated value";

  const riskFlags: RiskFlag[] = [];
  const narrative: string[] = [];

  narrative.push(`VERDICT: ${deal.verdict}. ${deal.decidingFactor}`);
  if (!Number.isNaN(arv.point)) {
    if (afterPlan === null) {
      narrative.push("The deal uses the fully renovated value: it takes the renovation (typed in, or priced from the condition) as bringing the house up to the renovated homes it is compared with.");
    } else {
      const left = opts.resale!.leftBelowPar;
      const names = left.map((b) => `${b.label.toLowerCase()} (${b.why === "skipped" ? "left as it is" : "refreshed where a replace was needed"})`).join(", ");
      if (deal.belowPar === "none") {
        narrative.push(`Resale after this plan $${fmt(afterPlan)}: the plan brings every part the photos show below par up to par, so it is the fully renovated value.`);
      } else if (deal.belowPar === "absorbed") {
        narrative.push(`Resale after this plan $${fmt(afterPlan)}: the plan leaves ${names} below par, but the block's ceiling stops the value at $${fmt(arv.point)} anyway, so that costs no resale here.`);
      } else {
        narrative.push(`Resale after this plan $${fmt(afterPlan)}, not the fully renovated $${fmt(arv.point)}: the plan leaves ${names} below par, and a buyer pays less for that. The deal is worked out on $${fmt(afterPlan)}.`);
      }
    }
  }

  if (Number.isNaN(arv.point)) {
    const widest = tiers[tiers.length - 1];
    riskFlags.push({ code: "NO_COMPS", message: `No usable comps within ${widest.radiusMiles} miles / ${widest.months} months. Do not rely on this number.` });
  } else {
    narrative.push(
      `ARV $${fmt(arv.point)} (range $${fmt(arv.low)} to $${fmt(arv.high)}, ${arv.confidence} confidence) from ${arv.comps.length} comps within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo.`,
    );
    if (!arv.conditionKnown) {
      narrative.push(
        "The records do not say what condition these homes sold in, so no sale was adjusted for it. The value is what homes like this one have been selling for around it; a house finished better than they were may sell for more, and that is not counted here.",
      );
    }
    if (config.monthlyAppreciation === 0 && arv.comps.some((c) => c.monthsAgo > 1)) {
      narrative.push("Older sales are taken at the price they sold for: nothing is added or taken off for the months since.");
    }
    const left = arv.leftOut.outliers + arv.leftOut.overAdjusted + arv.leftOut.lotSales;
    if (left > 0) {
      const why = [
        // "It" and "they" are the sold homes, each in its own year: not the house this report is about.
        arv.leftOut.lotSales
          ? `${arv.leftOut.lotSales} sold in the year ${arv.leftOut.lotSales === 1 ? "it was" : "they were"} built for under half of what a square foot usually goes for among these sales (as a rule the sale of the lot, before a house stood on it)`
          : "",
        arv.leftOut.outliers ? `${arv.leftOut.outliers} sold for under a quarter or over four times what a square foot usually goes for among these sales (as a rule, not a market sale)` : "",
        arv.leftOut.overAdjusted ? `${arv.leftOut.overAdjusted} differed from this house by more than ${Math.round(config.grossAdjustmentCap * 100)}% of the price in adjustments` : "",
      ].filter(Boolean);
      narrative.push(`${left} sale${left === 1 ? "" : "s"} in the search ${left === 1 ? "was" : "were"} left out: ${why.join("; ")}.`);
    }
    const newest = arv.comps.reduce((a, c) => (c.monthsAgo < a.monthsAgo ? c : a));
    if (newest.monthsAgo > STALE_AFTER_MONTHS) {
      riskFlags.push({ code: "STALE_SALES", message: `The newest comparable sale is from ${monthOf(newest.sale.saleDate)}. Prices may have moved since. Ask an agent for sales from the last three months before offering.` });
    }
  }

  if (arv.ceiling) {
    // What it is drawn from, said as that. With public records it is the sold homes read around this house that
    // stand in its zip code: not the whole zip code, which nobody read.
    const from = arv.ceiling.basis === "renovated" ? `top-decile renovated sales in ${subject.submarket} clear` : `the dearest tenth of the sold homes of this size found around this house in ${subject.submarket}, whatever their condition, cleared`;
    // Drawn from sales known to be renovated it is a cap. Drawn from all sales it is where homes of this size have topped out, and is not applied as one.
    const so = arv.ceiling.basis === "renovated" ? `so this square footage caps out near $${fmt(arv.ceiling.value)}.` : `so a home of this size has topped out near $${fmt(arv.ceiling.value)} (a guide, not a cap).`;
    narrative.push(`Neighborhood ceiling: ${from} $${fmt(arv.ceiling.pricePerSqft)}/sqft (n=${arv.ceiling.sampleSize}), ${so}`);
    if (arv.cappedByCeiling) {
      riskFlags.push({
        code: "CEILING_BINDS",
        message: `Comp math says $${fmt(arv.compBased)} but the block has never cleared $${fmt(arv.ceiling.value)}. Do not over-improve: target the median finish level and sell fast.`,
      });
    } else {
      const headroom = (arv.ceiling.value - arv.point) / arv.point;
      if (headroom < DEFAULT_MAX_RENOVATION_SPREAD) {
        narrative.push(`ARV sits within ${Math.round(headroom * 100)}% of the ceiling. Premium finishes will not be repaid here.`);
      }
    }
  } else if (arv.ceilingSetAside) {
    riskFlags.push({
      code: "NO_CEILING",
      message: `The sold homes compared here went for more than the dearest tenth of the sold homes of this size found around this house in ${subject.submarket} ($${fmt(arv.ceilingSetAside.pricePerSqft)}/sqft, n=${arv.ceilingSetAside.sampleSize}), so those do not say where this block tops out. Ceiling unknown; treat the high end of the ARV range with suspicion.`,
    });
  } else {
    riskFlags.push({
      code: "NO_CEILING",
      message: arv.conditionKnown
        ? "Fewer than 5 renovated sales in this submarket in 12 months. Ceiling unknown; treat the high end of the ARV range with suspicion."
        : "Too few of the sold homes found around this house are in its zip code and from the last 12 months to say where the market tops out. Ceiling unknown; treat the high end of the ARV range with suspicion.",
    });
  }

  if (arv.confidence === "LOW") {
    riskFlags.push({ code: "LOW_CONFIDENCE", message: "Comp set is thin or scattered. Get a broker opinion before offering." });
  }
  if (subject.yearBuilt === null) {
    riskFlags.push({ code: "YEAR_UNKNOWN", message: "The year built is not known. Find it before offering: before 1978 means lead paint handling and likely asbestos, before 1960 an inspection of the sewer line, panel and plumbing." });
  } else {
    if (subject.yearBuilt < 1978) {
      riskFlags.push({ code: "PRE_1978", message: "Built before 1978: budget for lead paint handling and likely asbestos in flooring or insulation." });
    }
    if (subject.yearBuilt < 1960) {
      riskFlags.push({ code: "OLD_SYSTEMS", message: "Pre-1960: assume the sewer line, electrical panel and plumbing need inspection before closing." });
    }
  }
  if (opts.deal.rehab === undefined) {
    riskFlags.push({ code: "REHAB_FROM_CONDITION", message: `Rehab $${fmt(rehab.likely)} is a condition-tier estimate ($${fmt(rehab.low)} to $${fmt(rehab.high)}), not a photo-based scope. A ${Math.round(dealInputs.hiddenRiskReserve * 100)}% reserve was added on top.` });
  }

  narrative.push(
    `Deal: purchase $${fmt(deal.purchasePrice)} + rehab $${fmt(deal.rehabWithReserve)} + holding $${fmt(deal.holdingCost)} + financing $${fmt(deal.financingCost)} + closing $${fmt(deal.closingBuy + deal.closingSell)} = $${fmt(deal.totalCost)} all-in against ${resaleName} $${fmt(deal.arv)}.`,
  );
  narrative.push(`Max allowable offer at $${fmt(dealInputs.targetProfit)} target profit: $${fmt(deal.maxAllowableOffer)}.`);

  return { subject, asOf, arv, rehab, deal, riskFlags, narrative };
}
