"use client";

import { useState } from "react";
import { planRenovation, type CategoryNeeds, type PlanItem } from "@/lib/engine/renovation";
import { DEFAULT_MARKET_CONFIG } from "@/lib/engine/defaults";
import type { PropertyFacts } from "@/lib/engine/types";
import { ValueLadder } from "@/components/report/value-ladder";

/**
 * The remodel plan, live. One sample house with a fixed photo assessment;
 * the visitor moves the block's ceiling and watches the planner drop the
 * work the neighborhood will not pay for. Same planRenovation() the report
 * runs, with the default (placeholder) unit costs.
 */

const SUBJECT: PropertyFacts = { id: "sample", lat: 0, lng: 0, submarket: "sample", sqft: 1_840, lotSqft: 6_000, beds: 3, baths: 2, yearBuilt: 1952, garage: 1, condition: "dated" };
const NEEDS: CategoryNeeds = { kitchen: "replace", baths: "replace", flooring: "refresh", paint: "refresh", exterior: "refresh", landscaping: "refresh", windows: "none", roof: "none", electrical: "unknown", plumbing: "replace", hvac: "unknown", basement: "none" };
const COMP_ARV = 845_000;
const PRESETS = [
  { label: "Modest block", ceiling: 780_000 },
  { label: "This block", ceiling: 845_000 },
  { label: "Premium block", ceiling: 920_000 },
];

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

const ACTION_STYLE: Record<PlanItem["action"], string> = {
  required: "bg-red-100 text-red-800",
  replace: "bg-brand-100 text-brand-700",
  refresh: "bg-brand-50 text-brand-700",
  inspect: "bg-amber-50 text-amber-800",
  skip: "bg-ink-100 text-ink-500",
};

export function RemodelPlan() {
  const [ceiling, setCeiling] = useState(845_000);
  const plan = planRenovation({
    subject: SUBJECT,
    currentCondition: "dated",
    needs: NEEDS,
    arvPoint: COMP_ARV,
    ceiling: { pricePerSqft: ceiling / SUBJECT.sqft, value: ceiling, sampleSize: 43 },
    config: DEFAULT_MARKET_CONFIG,
  });
  const work = plan.items.filter((i) => i.action !== "skip");
  const overkill = plan.items.filter((i) => i.action === "skip" && i.need !== "none");
  const atPar = plan.items.filter((i) => i.action === "skip" && i.need === "none");
  const afterPlan = plan.asIsValue + plan.totals.valueAdded;

  return (
    <div>
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink-700">What this block has paid for a renovated {SUBJECT.sqft.toLocaleString("en-US")} sqft house</span>
              <span className="text-lg font-semibold tabular-nums tracking-tight">{money(ceiling)}</span>
            </div>
            <input type="range" className="range mt-2" min={760_000} max={950_000} step={5_000} value={ceiling} onChange={(e) => setCeiling(Number(e.target.value))} aria-label="Block ceiling" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setCeiling(p.ceiling)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${ceiling === p.ceiling ? "border-ink-950 bg-ink-950 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-100"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="card flex flex-col p-5 lg:self-start" aria-live="polite">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Value, before and after</div>
          <div className="mt-3">
            <ValueLadder asIs={plan.asIsValue} afterPlan={afterPlan} arv={COMP_ARV} ceiling={ceiling} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
            {[
              ["Spend", `${money(plan.totals.costLow)}–${money(plan.totals.costHigh)}`],
              ["Adds", money(plan.totals.valueAdded)],
              ["Net", money(plan.totals.net)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-ink-100/70 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{k}</div>
                <div className="mt-0.5 text-[13px] font-semibold tabular-nums leading-tight">{v}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink-700">
            <span className="font-medium text-ink-950">Finish level: {plan.finishLevel}.</span> {plan.finishAdvice}
          </p>
          {overkill.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Overkill, skipped</div>
              {overkill.map((i) => (
                <p key={i.key} className="mt-1"><span className="font-semibold">{i.label}:</span> {i.reason}</p>
              ))}
            </div>
          )}
          <p className="mt-4 border-t border-ink-100 pt-4 text-xs text-ink-500">Rehab that feeds the deal: {money(plan.rehab.likely)} likely ({money(plan.rehab.low)}–{money(plan.rehab.high)}), before the hidden-risk reserve.</p>
        </div>

        <div className="card overflow-hidden">
          <div className="grid grid-cols-[5.5rem_1fr_5rem_5rem] gap-x-3 border-b border-ink-100 bg-ink-100/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500 sm:grid-cols-[5.5rem_1fr_5.5rem_5.5rem_5.5rem]">
            <span>Call</span><span>Item</span><span className="text-right">Cost</span><span className="hidden text-right sm:block">Adds</span><span className="text-right">Net</span>
          </div>
          <ul className="divide-y divide-ink-100">
            {work.map((i) => (
              <li key={i.key} className="grid grid-cols-[5.5rem_1fr_5rem_5rem] items-start gap-x-3 px-4 py-2.5 text-sm sm:grid-cols-[5.5rem_1fr_5.5rem_5.5rem_5.5rem]">
                <span><span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ACTION_STYLE[i.action]}`}>{i.action}</span></span>
                <span className="min-w-0">
                  <span className="font-medium">{i.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-500">{i.reason}</span>
                </span>
                <span className="text-right tabular-nums">{i.costLikely ? money(i.costLikely) : "—"}</span>
                <span className="hidden text-right tabular-nums sm:block">{i.valueAdded ? money(i.valueAdded) : "—"}</span>
                <span className={`text-right tabular-nums ${i.net < 0 ? "text-pass" : i.net > 0 ? "text-go" : "text-ink-500"}`}>{i.costLikely || i.valueAdded ? money(i.net) : "—"}</span>
              </li>
            ))}
            {atPar.length > 0 && (
              <li className="grid grid-cols-[5.5rem_1fr] items-start gap-x-3 px-4 py-2.5 text-sm">
                <span><span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ACTION_STYLE.skip}`}>skip</span></span>
                <span>
                  <span className="font-medium text-ink-700">{atPar.map((i) => i.label).join(", ")}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">Already at par for the block. Don&apos;t touch them.</span>
                </span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
