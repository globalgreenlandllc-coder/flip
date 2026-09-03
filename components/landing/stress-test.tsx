"use client";

import { useState } from "react";
import { evaluateDeal } from "@/lib/engine/deal";
import { DEFAULT_DEAL_TERMS } from "@/lib/engine/defaults";
import type { Verdict } from "@/lib/engine/types";
import { VerdictBadge } from "@/components/ui/verdict";

/**
 * Live deal math on the landing page. Three sliders feed the same
 * evaluateDeal() the report uses, with the default terms, so a visitor can
 * feel where GO turns into TIGHT and TIGHT into PASS before signing up.
 */

const START = { askingPrice: 565_000, arv: 845_000, rehab: 58_000 };

function money(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

const TONE: Record<Verdict, string> = { GO: "text-go", TIGHT: "text-tight", PASS: "text-pass" };

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span className="text-lg font-semibold tabular-nums tracking-tight">{money(value)}</span>
      </div>
      <input type="range" className="range mt-2" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-400">
        <span>{money(min)}</span>
        <span>{money(max)}</span>
      </div>
    </label>
  );
}

export function StressTest() {
  const [asking, setAsking] = useState(START.askingPrice);
  const [arv, setArv] = useState(START.arv);
  const [rehab, setRehab] = useState(START.rehab);
  const terms = { ...DEFAULT_DEAL_TERMS, askingPrice: asking, rehab };
  const d = evaluateDeal(arv, terms);
  const dirty = asking !== START.askingPrice || arv !== START.arv || rehab !== START.rehab;

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="card flex flex-col gap-7 p-6">
        <Slider label="Asking price" value={asking} min={450_000} max={750_000} step={5_000} onChange={setAsking} />
        <Slider label="After-repair value (ARV)" value={arv} min={700_000} max={950_000} step={5_000} onChange={setArv} />
        <Slider label="Rehab estimate" value={rehab} min={30_000} max={130_000} step={1_000} onChange={setRehab} />
        <div className="mt-auto flex items-end justify-between gap-4 border-t border-ink-100 pt-4">
          <p className="text-xs leading-relaxed text-ink-500">
            Default terms: {money(terms.targetProfit)} target profit, {terms.holdingMonths}-month hold, {Math.round(terms.financing.rate * 100)}% money at {Math.round(terms.financing.ltc * 100)}% of cost, {Math.round(terms.closingSellPct * 100)}% to sell, {Math.round(terms.hiddenRiskReserve * 100)}% hidden-risk reserve. All editable per deal in the app.
          </p>
          <button
            type="button"
            onClick={() => { setAsking(START.askingPrice); setArv(START.arv); setRehab(START.rehab); }}
            disabled={!dirty}
            className="shrink-0 text-xs font-medium text-ink-700 underline-offset-2 hover:underline disabled:opacity-40 disabled:hover:no-underline"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="card p-6" aria-live="polite">
        <div className="flex flex-wrap items-center gap-4">
          <VerdictBadge verdict={d.verdict} size="lg" />
          <p className="min-w-0 flex-1 text-sm leading-snug text-ink-700">{d.decidingFactor}</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-4">
          {[
            ["Profit", money(d.profit), TONE[d.verdict]],
            ["Max offer", money(d.maxAllowableOffer), ""],
            ["ROI", Number.isFinite(d.roi) ? `${Math.round(d.roi * 100)}%` : "—", ""],
            ["Worst case", money(d.worstCaseProfit), d.worstCaseProfit < 0 ? "text-pass" : ""],
          ].map(([k, v, c]) => (
            <div key={k} className="rounded-xl bg-ink-100/70 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{k}</div>
              <div className={`mt-0.5 font-semibold tabular-nums ${c}`}>{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Sensitivity · profit if ARV falls and rehab runs over</div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
            <div className="p-2 text-ink-500">ARV \ rehab</div>
            {["+0%", "+10%", "+20%"].map((h) => <div key={h} className="p-2 text-right font-medium text-ink-500">{h}</div>)}
            {[0, -0.05, -0.1].map((a) => (
              <div key={a} className="contents">
                <div className="p-2 tabular-nums text-ink-500">{a === 0 ? "0%" : `${Math.round(a * 100)}%`}</div>
                {d.sensitivity.filter((s) => s.arvDeltaPct === a).map((s) => {
                  const c = s.profit >= terms.targetProfit ? "bg-brand-100 text-brand-800" : s.profit > 0 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800";
                  return (
                    <div key={s.rehabDeltaPct} className={`rounded-md p-2 text-right font-medium tabular-nums transition-colors ${c}`}>{money(s.profit)}</div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-500">Green clears your target, amber is profitable but short, red loses money. GO needs the base case at target and every cell above zero.</p>
      </div>
    </div>
  );
}
