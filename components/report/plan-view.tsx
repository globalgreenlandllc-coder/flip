import type { RenovationPlan, PlanItem } from "@/lib/engine/renovation";
import { Block, money } from "./report-view";
import { ValueLadder } from "./value-ladder";

const ACTION_STYLE: Record<PlanItem["action"], string> = {
  required: "bg-red-100 text-red-800",
  replace: "bg-brand-100 text-brand-700",
  refresh: "bg-brand-50 text-brand-700",
  inspect: "bg-amber-50 text-amber-800",
  skip: "bg-ink-100 text-ink-500",
};

export function PlanView({ plan, demo = false, untested = false }: { plan: RenovationPlan; demo?: boolean; untested?: boolean }) {
  return (
    <Block title="What to remodel, ranked by profit" demo={demo}>
      <p className="mb-3 text-sm text-ink-700">
        As-is about {money(plan.asIsValue)}. Renovation can add up to {money(plan.uplift)}
        {Number.isFinite(plan.headroom) ? `, and the block will pay for about ${money(plan.headroom)} of it` : ""}.{" "}
        <span className="font-medium text-ink-900">{plan.finishAdvice}</span>
      </p>
      <ScopeLadder plan={plan} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-100/60 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Adds</th>
              <th className="px-3 py-2 text-right font-medium">Net</th>
              <th className="px-3 py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((i) => (
              <tr key={i.key} className={`border-t border-ink-100 align-top ${i.action === "skip" ? "text-ink-400" : ""}`}>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${ACTION_STYLE[i.action]}`}>{i.action}</span>
                </td>
                <td className="px-3 py-2 font-medium whitespace-nowrap">{i.label}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{i.costLikely ? `${money(i.costLow)} – ${money(i.costHigh)}` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.valueAdded ? money(i.valueAdded) : "—"}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${i.net < 0 ? "text-pass" : ""}`}>{i.costLikely || i.valueAdded ? money(i.net) : "—"}</td>
                <td className="px-3 py-2 text-ink-700">{i.reason}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-200 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{money(plan.totals.costLow)} – {money(plan.totals.costHigh)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(plan.totals.valueAdded)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${plan.totals.net < 0 ? "text-pass" : ""}`}>{money(plan.totals.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Costs are placeholder contractor rates for the Seattle area, not quotes for this house.
        {demo ? " What each item adds comes from the demo sales, so it is not real either." : ""}
        {untested ? " What each item adds follows the resale estimate above, which has not been accuracy-tested for this area." : ""}
      </p>
    </Block>
  );
}

/**
 * What a plan (or a scope chosen in Deal Studio's advisor) reaches: as-is, after it, fully renovated, the block's ceiling,
 * and what it leaves below par with what that costs in resale (2026-11-28). `scope`: the words for a scope the person
 * chose ("this scope") instead of the analysis' plan.
 */
export function ScopeLadder({ plan, scope = false, afterLabel }: { plan: RenovationPlan; scope?: boolean; afterLabel?: string }) {
  const what = scope ? "this scope" : "this plan";
  return (
    <div className="card mb-3 p-4" data-scope-ladder>
      <ValueLadder
        asIs={plan.asIsValue}
        // Plans saved before 2026-11-28 have no afterPlanValue: their ladder is drawn as it was then.
        afterPlan={plan.afterPlanValue ?? plan.asIsValue + plan.totals.valueAdded}
        afterLabel={plan.afterPlanValue === undefined ? undefined : (afterLabel ?? `Resale after ${what} · the deal uses this`)}
        arv={plan.asIsValue + plan.uplift}
        ceiling={Number.isFinite(plan.headroom) ? plan.asIsValue + plan.headroom : null}
      />
      {plan.leftBelowPar && (
        <p className="mt-3 text-xs leading-relaxed text-ink-700" data-left-below-par>
          {plan.leftBelowPar.length === 0
            ? `${scope ? "This scope" : "The plan"} brings every part the photos show below par up to par, so the resale after it is the fully renovated value.`
            : `Left below par by ${what}: ${plan.leftBelowPar.map((b) => `${b.label.toLowerCase()} (${b.why === "skipped" ? "left as it is" : "refreshed where a replace was needed"}${b.lost >= 1 ? `, ${money(b.lost)} of resale` : ""})`).join("; ")}.${plan.fullValue !== undefined && plan.afterPlanValue !== undefined && plan.afterPlanValue >= plan.fullValue ? " The block's ceiling stops the value there anyway, so this costs no resale." : ""}`}{" "}
          Parts not seen in the photos are counted as at par.
        </p>
      )}
    </div>
  );
}
