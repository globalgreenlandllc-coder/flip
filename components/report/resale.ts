import type { Report } from "@/lib/engine/types";
import { money } from "@/components/ui/format";

/**
 * Which resale value the deal is worked out on, in the words every screen uses (2026-11-28): what the planned work
 * reaches (a full analysis), or the fully renovated value (Quick numbers). A deal saved before then says only
 * "Resale value": it was worked out on the fully renovated value and keeps the numbers it was saved with.
 */
export function resaleWords(deal: Report["deal"]): { label: string; note: string | null } {
  // Deal Studio's advisor: a changed scope says where its resale comes from (2026-11-28).
  if (deal.resaleChoice === "estimate") return { label: "Resale for this scope · estimate", note: "Estimated for the scope chosen with placeholder rates for what each part adds; not measured from these sales" };
  if (deal.resaleChoice === "kept") return { label: "Resale kept", note: "Kept as it was when the scope changed; review it under Renovation budget" };
  if (deal.resaleChoice === "mine") {
    const full = deal.fullyRenovated;
    return typeof full === "number" && deal.arv > full + 0.5
      ? { label: "Your resale", note: `The resale you typed is above this house's fully renovated value, ${money(full)}: no GO rests on it` }
      : { label: "Your resale", note: "The resale you typed" };
  }
  if (deal.resaleBasis === "after-plan") {
    const full = deal.fullyRenovated;
    if (deal.belowPar === "costs" && typeof full === "number") return { label: "Resale after this plan", note: `Fully renovated it would be ${money(full)}; the plan leaves some of the house below par` };
    if (deal.belowPar === "absorbed") return { label: "Resale after this plan", note: "The plan leaves some parts below par; the block's ceiling stops the value there anyway" };
    if (deal.belowPar === "none") return { label: "Resale after this plan", note: "The plan brings every part the photos show below par up to par" };
    return { label: "Resale after this plan", note: null };
  }
  if (deal.resaleBasis === "fully-renovated") return { label: "Fully renovated value", note: "Takes the work as bringing the house up to the renovated homes it is compared with" };
  return { label: "Resale value", note: null };
}

/**
 * The resale rests on the plan's placeholder shares of what each part adds: a scope's estimate, or the analysis' own
 * when its plan leaves part of the house below par (then the resale is under the fully renovated value).
 */
export function resaleIsEstimate(deal: Report["deal"]): boolean {
  return deal.resaleEstimated ?? (deal.resaleBasis === "after-plan" && deal.belowPar === "costs");
}

/** Lines priced below the typical range for the work, in words: "Roof $0, typical $12,000–$18,000". */
export function belowTypicalWords(lines: NonNullable<Report["deal"]["costsBelowTypical"]>): string {
  return lines.map((l) => `${l.label} ${money(l.cost)}, typical ${money(l.low)}–${money(l.high)}`).join("; ");
}
