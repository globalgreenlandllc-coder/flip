"use client";

import { useMemo, useState } from "react";
import type { Report } from "@/lib/engine/types";
import { STUDIO_BOUNDS, clampInputs, liveNumbers, liveReport, sameInputs, studioBase, type LiveNumbers, type StudioInputs } from "@/lib/engine/studio";
import { saveScenario } from "@/app/app/deals/actions";
import { DemoTag } from "@/components/ui/demo";
import { Icon } from "@/components/ui/icon";
import { money } from "@/components/ui/format";
import { resaleWords } from "./resale";

export interface Studio {
  /** False: the deal is shown as analysed and cannot be changed (why says why). */
  editable: boolean;
  why: "saved-before" | "numbers-differ" | "no-deal" | null;
  /** The analysis' own inputs (when editable). */
  analysed: StudioInputs | null;
  inputs: StudioInputs | null;
  set: (key: keyof StudioInputs, value: number) => void;
  setAll: (next: StudioInputs) => void;
  reset: () => void;
  /** The inputs differ from the analysis'. */
  changed: boolean;
  live: LiveNumbers | null;
  /** The result to show: the live deal in place of the analysed one when editable, the result itself otherwise. */
  shown: Report;
  /** The base renovation and resale the live deal is worked on. */
  rehab: number;
  resale: number;
}

/**
 * Deal Studio's state for one result: the analysis' inputs, the person's, and the deal worked again from them in the
 * browser (lib/engine/studio.ts). `stored`: a saved scenario's inputs to open on.
 */
export function useStudio(report: Report, demo: boolean, stored?: StudioInputs | null): Studio {
  const base = useMemo(() => studioBase(report), [report]);
  const analysed = base.editable ? base.inputs : null;
  const [inputs, setInputs] = useState<StudioInputs | null>(() => (base.editable ? clampInputs(stored ?? base.inputs) : null));
  // The analysed price is passed so a different price is called "your price", never the asking price.
  const live = useMemo(() => (base.editable && inputs ? liveNumbers(base.rehab, base.resale, inputs, report.deal.purchasePrice) : null), [base, inputs, report]);
  const shown = useMemo(() => (live ? liveReport(report, live.deal, { demo }) : report), [report, live, demo]);
  const changed = !!(analysed && inputs && !sameInputs(analysed, inputs));
  return {
    editable: base.editable,
    why: base.editable ? null : base.why,
    analysed,
    inputs,
    set: (key, value) => setInputs((was) => (was ? clampInputs({ ...was, [key]: value }) : was)),
    setAll: (next) => setInputs(clampInputs(next)),
    reset: () => setInputs(analysed),
    changed,
    live,
    shown,
    rehab: base.editable ? base.rehab : 0,
    resale: base.editable ? base.resale : report.deal.arv,
  };
}

const pctText = (n: number | null, digits = 1) => (n === null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`);

/** What a field shows: dollars with commas; percents as used, to two places at most (12.5, not 13). */
function fieldText(value: number, unit: "$" | "%" | "$/mo", scale: number): string {
  return unit === "%" ? String(Number((value * scale).toFixed(2))) : Math.round(value * scale).toLocaleString("en-US");
}

/** What a typed field reads as, or null when it does not read as a number. */
function readTyped(text: string): number | null {
  const n = Number(text.replace(/[$,%\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}

/**
 * A number field that lets the person type freely and takes the number when it reads as one. While it is being typed
 * in, a note under it says the number actually used whenever that is not what the field shows (held to its range, or
 * not read as a number at all), so the screen never shows one number and works with another.
 */
function NumberField({ id, label, value, onChange, unit, scale = 1, disabled, hint }: { id: string; label: string; value: number; onChange: (n: number) => void; unit: "$" | "%" | "$/mo"; scale?: number; disabled?: boolean; hint?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const prefix = unit === "$" || unit === "$/mo" ? "$" : "";
  const suffix = unit === "%" ? "%" : unit === "$/mo" ? "/mo" : "";
  const used = fieldText(value, unit, scale);
  const typed = draft === null ? null : readTyped(draft);
  const differs = draft !== null && (typed === null || Math.abs(typed / scale - value) > 1e-9);
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-semibold text-ink-700" htmlFor={id}>
        {label}
      </label>
      <div className={`studio-field flex items-center rounded-[10px] border border-[#dde0dc] bg-white ${disabled ? "opacity-60" : ""}`}>
        {prefix && <span className="pl-3 text-sm text-ink-500">{prefix}</span>}
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          aria-describedby={differs ? `${id}-used` : undefined}
          className="w-full min-w-0 bg-transparent px-3 py-2 text-[15px] font-semibold text-ink-900 tabular"
          value={draft ?? used}
          // Nothing is reformatted on focus: a field rewritten as it gets focus loses its selection, and what is typed
          // over it lands after the old number ("60,000" + "80000" read as $6,000,080,000).
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = readTyped(e.target.value);
            if (n !== null) onChange(n / scale);
          }}
        />
        {suffix && <span className="pr-3 text-sm text-ink-500">{suffix}</span>}
      </div>
      {differs ? (
        <p id={`${id}-used`} className="mt-1 text-[11px] font-semibold text-[#b9411d]" data-field-used>
          {typed === null ? "Not read as a number: using" : "Using"} {prefix}
          {used}
          {suffix}
        </p>
      ) : (
        hint && <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
      )}
    </div>
  );
}

/** One figure of the lab: a label, the number, and a line under it. */
function Figure({ label, value, sub, tag, data }: { label: string; value: string; sub: string; tag?: boolean; data: string }) {
  return (
    <div className="min-w-0" data-lab={data}>
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-500">
        {label}
        {tag && <DemoTag />}
      </p>
      <p className="tabular mt-1 text-xl font-bold tracking-tight text-ink-950">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{sub}</p>
    </div>
  );
}

/**
 * The offer lab (the design's "Your purchase price" panel): the price paid, with a slider and "Use maximum offer";
 * the resale it is worked against (never moved by these numbers), the cash it needs, the return on cost and on cash;
 * the timeline, and what one more month costs; the target and every assumption, to change. All worked in the browser:
 * nothing here asks the server.
 */
export function OfferLab({ studio, report, demo, priceWhat }: { studio: Studio; report: Report; demo: boolean; priceWhat: string }) {
  const [open, setOpen] = useState(false);
  const asking = report.deal.purchasePrice;
  const resale = resaleWords(report.deal);
  if (!studio.editable || !studio.inputs || !studio.live) {
    return (
      <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4" data-price-bar data-studio-readonly>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#fff1ea] text-[#c8431f]">
            <Icon name="lock" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink-900">Asking price {money(asking)}</p>
            <p className="text-xs text-ink-500">{priceWhat}</p>
          </div>
        </div>
        <p className="text-sm text-ink-700 sm:ml-auto sm:max-w-xl">
          {studio.why === "saved-before"
            ? "This deal was saved before RenoFlip kept its assumptions, so it shows the numbers as analyzed and cannot be changed here. Analyze the house again to work with the price, the timeline and the assumptions."
            : "These numbers can only be shown as they were analyzed."}
        </p>
      </div>
    );
  }
  const x = studio.inputs;
  const live = studio.live;
  const sliderMax = Math.max(100_000, Math.ceil((Math.max(asking, studio.resale) * 1.25) / 10_000) * 10_000);
  const maxOffer = live.deal.maxAllowableOffer;
  const gap = Math.abs(x.purchase - maxOffer) < 1 ? 0 : Math.round(x.purchase - maxOffer);
  const atAsking = Math.abs(x.purchase - asking) < 0.5;
  return (
    <section className="rounded-[14px] border border-ink-200 bg-white p-5 sm:p-6" data-price-bar data-offer-lab>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <label htmlFor="studio-purchase" className="text-sm font-bold text-ink-900">
            Your purchase price
          </label>
          <p className="mt-0.5 text-xs text-ink-500" data-lab-asking>
            {priceWhat}: {money(asking)}
            {!atAsking && (
              <button type="button" className="ml-2 font-semibold text-[#b9411d] underline underline-offset-2" onClick={() => studio.set("purchase", asking)}>
                back to it
              </button>
            )}
          </p>
          <PriceInput value={x.purchase} onChange={(n) => studio.set("purchase", n)} />
          <input
            type="range"
            aria-label="Purchase price"
            aria-valuetext={money(x.purchase)}
            id="studio-purchase-range"
            className="mt-3 w-full accent-[#e8572c]"
            min={0}
            max={sliderMax}
            step={1_000}
            value={Math.min(sliderMax, Math.round(x.purchase))}
            onChange={(e) => studio.set("purchase", Number(e.target.value))}
          />
          <div className="flex justify-between text-[11px] text-ink-500">
            <span>$0</span>
            <span>{money(sliderMax)}</span>
          </div>
          <p className="mt-3 text-sm text-ink-700" data-lab-gap>
            {maxOffer < 0 ? (
              "No price reaches the target on this resale value."
            ) : gap === 0 ? (
              "This is the maximum offer for the target."
            ) : (
              <>
                {money(Math.abs(gap))} {gap > 0 ? "above" : "below"} the maximum offer of <span className="tabular font-bold text-ink-950">{money(maxOffer)}</span>
              </>
            )}
            {demo && <DemoTag className="ml-2 align-middle" />}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-accent text-sm" disabled={maxOffer < 0} onClick={() => studio.set("purchase", Math.floor(maxOffer))} data-use-max-offer>
              Use maximum offer
            </button>
            <button type="button" className="btn-secondary text-sm" aria-expanded={open} aria-controls="studio-assumptions" onClick={() => setOpen((v) => !v)} data-studio-assumptions-toggle>
              {open ? "Hide target & assumptions" : "Edit target & assumptions"}
            </button>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            <Figure label={resale.label} value={money(studio.resale)} sub="What the analysis found; these numbers do not move it" tag={demo} data="resale" />
            <Figure label="Cash needed" value={money(live.cashNeeded)} sub="Every cost before the sale, less the loan" tag={demo} data="cash" />
            <Figure label="Return on project cost" value={pctText(live.roiOnCost)} sub="Profit ÷ total project cost" tag={demo} data="roi-cost" />
            <Figure label="Return on cash" value={pctText(live.roiOnCash, 0)} sub="Profit ÷ the cash you put in" tag={demo} data="roi-cash" />
          </div>
          <div className="rounded-[12px] bg-[#f4f7f3] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="studio-months" className="text-sm font-bold text-ink-900">
                Timeline: <span className="tabular" data-lab-months>{x.months}</span> month{x.months === 1 ? "" : "s"} to resale
              </label>
              <span className="text-xs text-ink-500">Holding costs and loan interest follow the months</span>
            </div>
            <input
              type="range"
              id="studio-months"
              className="mt-2 w-full accent-[#e8572c]"
              min={STUDIO_BOUNDS.months.min}
              max={STUDIO_BOUNDS.months.max}
              step={1}
              aria-valuetext={`${x.months} month${x.months === 1 ? "" : "s"}`}
              value={x.months}
              onChange={(e) => studio.set("months", Number(e.target.value))}
            />
            <div className="flex justify-between text-[11px] text-ink-500">
              <span>{STUDIO_BOUNDS.months.min} month</span>
              <span>{STUDIO_BOUNDS.months.max} months</span>
            </div>
            <p className="mt-2 text-sm text-ink-700" data-lab-month>
              One more month costs <span className="tabular font-bold text-ink-950">{money(live.oneMoreMonth.cost)}</span> and leaves {money(live.oneMoreMonth.profit)}. With the downside on top (resale 10% lower, the work 20% higher):{" "}
              <span className={`tabular font-bold ${live.downsideWithMonth < 0 ? "text-pass" : "text-ink-950"}`}>{money(live.downsideWithMonth)}</span>.
              {demo && <DemoTag className="ml-2 align-middle" />}
            </p>
          </div>
        </div>
      </div>

      <div id="studio-assumptions" hidden={!open} className="mt-6 border-t border-ink-200 pt-5" data-studio-assumptions>
        <p className="text-sm font-bold text-ink-900">Target & assumptions</p>
        <p className="mt-0.5 text-xs text-ink-500">Changing them moves the costs, the profit and the maximum offer. None of them changes the resale value.</p>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <NumberField id="studio-target" label="Target profit" unit="$" value={x.targetProfit} onChange={(n) => studio.set("targetProfit", n)} hint="The maximum offer is solved for this" />
          <NumberField id="studio-rate" label="Loan interest" unit="%" scale={100} value={x.rate} onChange={(n) => studio.set("rate", n)} hint="A year" />
          <NumberField id="studio-ltc" label="Loan-to-cost" unit="%" scale={100} value={x.ltc} onChange={(n) => studio.set("ltc", n)} hint="Of price and renovation" />
          <NumberField id="studio-points" label="Loan points" unit="%" scale={100} value={x.points} onChange={(n) => studio.set("points", n)} hint="Of the loan" />
          <NumberField id="studio-holding" label="Holding costs" unit="$/mo" value={x.monthlyHolding} onChange={(n) => studio.set("monthlyHolding", n)} hint="Taxes, insurance, utilities" />
          <NumberField id="studio-buy" label="Buying costs" unit="%" scale={100} value={x.closingBuyPct} onChange={(n) => studio.set("closingBuyPct", n)} hint="Of the price" />
          <NumberField id="studio-sell" label="Selling costs" unit="%" scale={100} value={x.closingSellPct} onChange={(n) => studio.set("closingSellPct", n)} hint="Of the resale, commissions included" />
          <NumberField id="studio-reserve" label="Reserve on the renovation" unit="%" scale={100} value={x.reserve} onChange={(n) => studio.set("reserve", n)} hint="For what photos cannot show" />
        </div>
        <p className="mt-3 text-[11px] text-ink-500">
          Allowed: interest up to {STUDIO_BOUNDS.rate.max * 100}%, points up to {STUDIO_BOUNDS.points.max * 100}%, selling costs up to {STUDIO_BOUNDS.closingSellPct.max * 100}%; the timeline slider goes from {STUDIO_BOUNDS.months.min} to {STUDIO_BOUNDS.months.max} months.
        </p>
      </div>
    </section>
  );
}

/** The purchase price field: typed freely, read as dollars; a note when the price used is not what is typed. */
function PriceInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const used = Math.round(value).toLocaleString("en-US");
  const typed = draft === null ? null : readTyped(draft);
  const differs = draft !== null && (typed === null || Math.abs(typed - value) > 0.005);
  return (
    <>
      <div className="studio-field mt-3 flex items-center rounded-[10px] border border-[#dde0dc] bg-white">
        <span className="pl-3 text-sm text-ink-500">$</span>
        <input
          id="studio-purchase"
          inputMode="numeric"
          aria-describedby={differs ? "studio-purchase-used" : undefined}
          className="w-full min-w-0 bg-transparent px-3 py-2.5 text-[18px] font-bold text-ink-950 tabular"
          value={draft ?? used}
          // As NumberField: no reformat on focus, so typing over the selected price replaces it.
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = readTyped(e.target.value);
            if (n !== null) onChange(n);
          }}
        />
      </div>
      {differs && (
        <p id="studio-purchase-used" className="mt-1 text-[11px] font-semibold text-[#b9411d]" data-field-used>
          {typed === null ? "Not read as a number: using" : "Using"} ${used}
        </p>
      )}
    </>
  );
}

/**
 * Save the scenario of a saved deal (one per deal: it replaces the one kept before; the analysis' own numbers remove
 * it). The server works the numbers out again before keeping them. `kept`: the inputs the deal holds now (its saved
 * scenario, or null for the analysis' own), so the bar can say plainly when the screen shows changes not yet saved.
 */
export function SaveScenarioButton({ dealId, studio, kept }: { dealId: string; studio: Studio; kept: StudioInputs | null }) {
  const [state, setState] = useState<{ status: "idle" | "saving" | "error"; message?: string }>({ status: "idle" });
  const [held, setHeld] = useState<StudioInputs | null>(kept);
  if (!studio.editable || !studio.inputs || !studio.analysed) return null;
  const current = studio.inputs;
  const holding = held ?? studio.analysed;
  const unsaved = !sameInputs(holding, current);
  async function onSave() {
    setState({ status: "saving" });
    try {
      const result = await saveScenario(dealId, current);
      if (result.ok) {
        setHeld(result.kept ? current : null);
        setState({ status: "idle" });
      } else setState({ status: "error", message: result.error });
    } catch {
      setState({ status: "error", message: "Could not save just now. Try again." });
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`text-sm ${unsaved ? "font-semibold text-[#b9411d]" : "text-ink-700"}`} data-scenario-state={unsaved ? "unsaved" : "saved"}>
        {unsaved ? "Changes since saving" : held ? "Scenario saved with the deal." : "The deal holds the analysis' numbers: no scenario kept."}
      </span>
      <button type="button" onClick={onSave} disabled={state.status === "saving" || !unsaved} className="btn-accent text-sm" data-save-scenario>
        <Icon name="bookmark" className="h-4 w-4" />
        {state.status === "saving" ? "Saving…" : "Save this scenario"}
      </button>
      {state.status === "error" && <span className="text-sm text-pass">{state.message}</span>}
    </div>
  );
}
