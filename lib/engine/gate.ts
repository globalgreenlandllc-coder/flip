import type { GateReason, Report } from "./types";
import { fmt } from "./deal";

/**
 * When a GO may not be given.
 *
 * The deal math answers one question: do the numbers work. A GO says more
 * than that: go and offer. So a GO is withheld, and CHECK FIRST shown in its
 * place with what would clear it, while
 *
 *   - the area has not passed flip's accuracy test. No area has yet: the
 *     method that turns real sales into a resale value has only ever been
 *     run against made-up data, and its rates are placeholders;
 *   - the resale value is low-confidence: few comparable sales, prices that
 *     lie far apart, or sales that had to be looked for far away. The reason
 *     given is the one that holds (ArvEstimate.lowBecause), not a list of
 *     what it might be.
 *
 * TIGHT and PASS stand as they are: both already tell the reader not to
 * offer at this price. A third reason, an open critical risk, comes with the
 * risk step.
 *
 * Not applied to demo results. Those are made up from end to end and say so
 * in the verdict itself.
 */
export interface GateContext {
  /** Has this house's area passed the accuracy test (plan section 25)? */
  areaTested: boolean;
}

export function gateReasons(report: Report, ctx: GateContext): GateReason[] {
  const reasons: GateReason[] = [];
  if (!ctx.areaTested) {
    reasons.push({
      code: "AREA_UNTESTED",
      message: "RenoFlip's resale estimate has not been tested against real completed flips in this area yet.",
      clears: "The area's accuracy test (not run yet). Until then, check the sold homes below yourself or with an agent.",
    });
  }
  if (report.arv.confidence === "LOW") {
    const { comps, spreadPct, criteriaUsed } = report.arv;
    const why = (report.arv.lowBecause ?? []).map((reason) =>
      reason === "few"
        ? comps.length === 1
          ? "there is only one comparable sale"
          : `there are only ${comps.length} comparable sales`
        : reason === "apart"
          ? `the comparable sales' adjusted prices lie ${Math.round(spreadPct * 100)}% apart`
          : `comparable sales had to be looked for as far as ${criteriaUsed.radiusMiles} mile${criteriaUsed.radiusMiles === 1 ? "" : "s"} away and ${criteriaUsed.months} months back`,
    );
    reasons.push({
      code: "LOW_CONFIDENCE",
      message: why.length ? `The resale value is low-confidence: ${why.join(", and ")}.` : "The resale value is low-confidence.",
      clears: "A broker's opinion of the resale value, or more recent sales of homes like this one nearby.",
    });
  }
  return reasons;
}

/**
 * The report with its GO withheld where one may not be given. The deal's
 * numbers are untouched; only the verdict, the sentence beside it and the
 * first line of the narrative change, and `deal.withheld` says why.
 */
export function withGate(report: Report, ctx: GateContext): Report {
  if (report.deal.verdict !== "GO") return report;
  const reasons = gateReasons(report, ctx);
  if (reasons.length === 0) return report;
  const { deal } = report;
  // The reasons as one sentence: each without its full stop, the later ones without their capital.
  const why = reasons.map((r, i) => (i === 0 ? r.message : r.message[0].toLowerCase() + r.message.slice(1)).replace(/\.$/, "")).join("; and ");
  const decidingFactor = `The numbers work at this price: asking is $${fmt(-deal.askingVsMao)} under the max offer, and the deal survives ARV -10% with rehab +20%. It is not a GO yet: ${why}.`;
  return {
    ...report,
    deal: { ...deal, verdict: "CHECK FIRST", decidingFactor, withheld: reasons },
    narrative: [`VERDICT: CHECK FIRST. ${decidingFactor}`, ...report.narrative.slice(1)],
  };
}
