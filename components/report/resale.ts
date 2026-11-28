import type { Report } from "@/lib/engine/types";
import { money } from "@/components/ui/format";

/**
 * Which resale value the deal is worked out on, in the words every screen uses (2026-11-28): what the planned work
 * reaches (a full analysis), or the fully renovated value (Quick numbers). A deal saved before then says only
 * "Resale value": it was worked out on the fully renovated value and keeps the numbers it was saved with.
 */
export function resaleWords(deal: Report["deal"]): { label: string; note: string | null } {
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
