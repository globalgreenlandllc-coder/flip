import type { RenovationPlan, PlanItem } from "@/lib/engine/renovation";
import { Block, money } from "./report-view";

const ACTION_STYLE: Record<PlanItem["action"], string> = {
  required: "bg-red-100 text-red-800",
  replace: "bg-brand-100 text-brand-700",
  refresh: "bg-brand-50 text-brand-700",
  inspect: "bg-amber-50 text-amber-800",
  skip: "bg-ink-100 text-ink-500",
};

export function PlanView({ plan }: { plan: RenovationPlan }) {
  return (
    <Block title="What to remodel, ranked by profit">
      <p className="mb-3 text-sm text-ink-700">
        As-is about {money(plan.asIsValue)}. Renovation can add up to {money(plan.uplift)}
        {Number.isFinite(plan.headroom) ? `, and the block will pay for about ${money(plan.headroom)} of it` : ""}.{" "}
        <span className="font-medium text-ink-900">{plan.finishAdvice}</span>
      </p>
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
    </Block>
  );
}
