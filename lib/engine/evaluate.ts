import type { DealInputs, MarketConfig, PropertyFacts, Report, RiskFlag, Sale } from "./types";
import { estimateArv } from "./arv";
import { evaluateDeal, fmt } from "./deal";
import { rehabFromCondition } from "./rehab";

export interface EvaluateOptions {
  subject: PropertyFacts;
  sales: Sale[];
  asOf: string;
  config: MarketConfig;
  /** Deal inputs. If rehab is omitted, the condition-tier estimate is used. */
  deal: Omit<DealInputs, "rehab"> & { rehab?: number };
}

const DEFAULT_MAX_RENOVATION_SPREAD = 0.15;

export function evaluate(opts: EvaluateOptions): Report {
  const { subject, sales, asOf, config } = opts;
  const arv = estimateArv(subject, sales, asOf, config);
  const rehab = rehabFromCondition(subject.condition, subject.sqft, config);
  const dealInputs: DealInputs = { ...opts.deal, rehab: opts.deal.rehab ?? rehab.likely };
  const deal = evaluateDeal(arv.point, dealInputs);

  const riskFlags: RiskFlag[] = [];
  const narrative: string[] = [];

  narrative.push(`VERDICT: ${deal.verdict}. ${deal.decidingFactor}`);

  if (Number.isNaN(arv.point)) {
    riskFlags.push({ code: "NO_COMPS", message: "No usable comps within 2.5 miles / 18 months. Do not rely on this number." });
  } else {
    narrative.push(
      `ARV $${fmt(arv.point)} (range $${fmt(arv.low)} to $${fmt(arv.high)}, ${arv.confidence} confidence) from ${arv.comps.length} comps within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo.`,
    );
  }

  if (arv.ceiling) {
    narrative.push(
      `Neighborhood ceiling: top-decile renovated sales in ${subject.submarket} clear $${fmt(arv.ceiling.pricePerSqft)}/sqft (n=${arv.ceiling.sampleSize}), so this square footage caps out near $${fmt(arv.ceiling.value)}.`,
    );
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
  } else {
    riskFlags.push({ code: "NO_CEILING", message: "Fewer than 5 renovated sales in this submarket in 12 months. Ceiling unknown; treat the high end of the ARV range with suspicion." });
  }

  if (arv.confidence === "LOW") {
    riskFlags.push({ code: "LOW_CONFIDENCE", message: "Comp set is thin or scattered. Get a broker opinion before offering." });
  }
  if (subject.yearBuilt < 1978) {
    riskFlags.push({ code: "PRE_1978", message: "Built before 1978: budget for lead paint handling and likely asbestos in flooring or insulation." });
  }
  if (subject.yearBuilt < 1960) {
    riskFlags.push({ code: "OLD_SYSTEMS", message: "Pre-1960: assume the sewer line, electrical panel and plumbing need inspection before closing." });
  }
  if (opts.deal.rehab === undefined) {
    riskFlags.push({ code: "REHAB_FROM_CONDITION", message: `Rehab $${fmt(rehab.likely)} is a condition-tier estimate ($${fmt(rehab.low)} to $${fmt(rehab.high)}), not a photo-based scope. A ${Math.round(dealInputs.hiddenRiskReserve * 100)}% reserve was added on top.` });
  }

  narrative.push(
    `Deal: purchase $${fmt(deal.purchasePrice)} + rehab $${fmt(deal.rehabWithReserve)} + holding $${fmt(deal.holdingCost)} + financing $${fmt(deal.financingCost)} + closing $${fmt(deal.closingBuy + deal.closingSell)} = $${fmt(deal.totalCost)} all-in against ARV $${fmt(deal.arv)}.`,
  );
  narrative.push(`Max allowable offer at $${fmt(dealInputs.targetProfit)} target profit: $${fmt(deal.maxAllowableOffer)}.`);

  return { subject, asOf, arv, rehab, deal, riskFlags, narrative };
}
