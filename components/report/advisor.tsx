"use client";

import { useMemo, useState } from "react";
import type { CompResult, Report } from "@/lib/engine/types";
import type { CategoryKey, PlanItem, ScopeOption } from "@/lib/engine/renovation";
import { ADVISOR_BOUNDS, APPROACHES, approaches, bestAgainstNow, belowTypical, choiceKeys, compsAtOrAbove, compsByCondition, compsCondition, highestProfit, resaleIsEstimate, scopeWords, type BestScope } from "@/lib/engine/advisor";
import { DemoTag, EstimateTag, UntestedTag } from "@/components/ui/demo";
import { money } from "@/components/ui/format";
import { NumberField, type Studio } from "./studio";
import { Block } from "./report-view";
import { ScopeLadder } from "./plan-view";
import { belowTypicalWords } from "./resale";

const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`);

/**
 * How the comparable sales were adjusted, in words that hold for these sales: to this house fully renovated only where
 * the records say the condition each sold in (the demo's do; real records as a rule do not: comps.ts compareToComp).
 */
function adjustedWords(comps: CompResult[]): string {
  const c = compsCondition(comps);
  if (c.adjusted === "all") return "adjusted to this house fully renovated";
  if (c.adjusted === "none") return "adjusted for size and features, not for condition (the records don't say it)";
  return `adjusted for size and features, and for condition only where the record says it (${c.withCondition} of ${c.total})`;
}

/** The marks a figure carries: DEMO on made-up sales; on real sold prices UNTESTED, and ESTIMATE where it rests on placeholder rates. */
function Marks({ demo, untested, estimate }: { demo: boolean; untested: boolean; estimate?: boolean }) {
  return (
    <>
      {estimate && <EstimateTag className="ml-1.5" />}
      {demo ? <DemoTag className="ml-1.5" /> : untested ? <UntestedTag className="ml-1.5" /> : null}
    </>
  );
}

const OPTION_WORD: Record<ScopeOption, string> = { skip: "Leave", refresh: "Refresh", replace: "Replace" };

/**
 * Deal Studio's renovation advisor (the design's "Choose your approach" and "Make the plan yours"): three approaches
 * with what each costs, may sell for and leaves at the person's price; the scope with the highest profit; every line of
 * the plan to leave, refresh or replace, with its cost to change and "my crew is X% cheaper". All worked in the browser.
 */
export function AdvisorPanel({ studio, report, demo, untested }: { studio: Studio; report: Report; demo: boolean; untested: boolean }) {
  const a = studio.advisor;
  const x = studio.inputs;
  const asking = report.deal.purchasePrice;
  const cards = useMemo(() => (a && x ? approaches(a.base, x, a.state.crewPct, asking) : []), [a, x, asking]);
  const [best, setBest] = useState<{ key: string; best: BestScope } | null>(null);
  const [typing, setTyping] = useState(false);
  if (!a || !x || !studio.live) return null;
  const live = studio.live;
  const range = report.arv;
  const bestKey = JSON.stringify([x, a.state.costs, a.state.crewPct]);
  const shownBest = best && best.key === bestKey ? best.best : null;
  // Like with like: the scope now on its own estimated resale, as the best scope is.
  const vs = shownBest ? bestAgainstNow(a.base, x, a.state, shownBest, asking) : null;
  const keys = choiceKeys(a.base.basis);
  const resaleNow = studio.resale;
  const estimateNow = a.now.estimate;
  const atYourPrice = Math.abs(x.purchase - asking) < 0.5 ? `at the asking price of ${money(asking)}` : `at your price of ${money(x.purchase)}`;

  return (
    <section className="space-y-6" data-advisor>
      <div>
        <p className="kicker text-[#b9411d]">Choose your approach</p>
        <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.04em] text-ink-950">
          More renovation. <span className="text-ink-500">Or more return?</span>
        </h3>
        <p className="mt-2 max-w-3xl text-sm text-ink-700">
          What each approach costs, what it may sell for, and what it leaves you {atYourPrice}, with your timeline and assumptions.
          {demo
            ? " On demo numbers."
            : `${
                a.base.analysisEstimated
                  ? " Every approach's resale here is an estimate, Market-ready's too: the analysis' plan leaves part of the house below par, and what each part adds comes from placeholder rates, not from these sales."
                  : " Cosmetic and Premium's resale is an estimate: what each part adds comes from placeholder rates, not from these sales. Market-ready's is the analysis' own, the fully renovated value."
              } Similar homes, ${adjustedWords(report.arv.comps)}, sold for ${money(range.low)} to ${money(range.high)} (the middle of the sales).`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3" data-approaches>
        {cards.map((c) => {
          const selected = a.approach === c.id;
          // In use only when the scope AND the resale are the card's: the same scope on another resale can still be
          // clicked, to take the card's resale back.
          const inUse = selected && Math.abs(resaleNow - c.resale) < 0.5;
          const noPrice = c.live.deal.maxAllowableOffer < 0;
          return (
            <div key={c.id} className={`flex min-w-0 flex-col rounded-[14px] border p-5 ${selected ? "border-ink-950 bg-ink-950 text-white" : "border-ink-200 bg-white"}`} data-approach={c.id} data-approach-selected={selected ? "true" : undefined} data-approach-estimated={c.estimated ? "true" : "false"}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  {selected && <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffb59a]">Selected</p>}
                  <p className="text-xl font-bold tracking-tight">{c.label}</p>
                </div>
                {c.id === "ready" && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${selected ? "bg-white/15 text-white" : "bg-[#fff1ea] text-[#b9411d]"}`}>The analysis</span>}
              </div>
              <p className={`mt-1 text-xs ${selected ? "text-[#c3ccd0]" : "text-ink-500"}`}>{c.blurb}</p>
              <dl className={`mt-4 space-y-1.5 text-sm ${selected ? "text-[#dfe5e8]" : "text-ink-700"}`}>
                <div className="flex justify-between gap-3">
                  <dt>Renovation</dt>
                  <dd className="tabular font-semibold" data-approach-rehab>{money(c.rehab)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3">
                  <dt className="flex items-center">
                    Resale
                    <Marks demo={demo} untested={untested} estimate={c.estimated && !demo} />
                  </dt>
                  <dd className="tabular font-semibold" data-approach-resale>{money(c.resale)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Margin</dt>
                  <dd className="tabular font-semibold">{pct(c.live.margin)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Maximum buy price</dt>
                  <dd className="tabular font-semibold">{noPrice ? "None" : money(c.live.deal.maxAllowableOffer)}</dd>
                </div>
              </dl>
              <div className={`mt-4 border-t pt-3 ${selected ? "border-white/15" : "border-ink-200"}`}>
                <p className={`text-xs ${selected ? "text-[#c3ccd0]" : "text-ink-500"}`}>Potential profit</p>
                <p className={`tabular text-[28px] font-bold tracking-[-0.04em] ${c.live.deal.profit < 0 ? (selected ? "text-[#ff9a8a]" : "text-pass") : ""}`} data-approach-profit>
                  {money(c.live.deal.profit)}
                </p>
                {c.belowTypical.length > 0 && (
                  <p className={`mt-1 text-xs font-semibold ${selected ? "text-[#ffb59a]" : "text-[#b9411d]"}`} data-approach-below-typical>
                    Your crew&apos;s discount takes {c.belowTypical.map((l) => l.label).join(", ")} below the typical range for the work.
                  </p>
                )}
              </div>
              <button type="button" aria-pressed={inUse} disabled={inUse} onClick={() => a.applyApproach(c.id)} className={`mt-3 ${inUse ? "btn-secondary opacity-80" : "btn-secondary"} text-sm`} data-use-approach={c.id}>
                {inUse ? "In use" : selected ? `Use ${c.label}'s resale` : `Use ${c.label}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="-mt-2 text-xs text-ink-500" data-approaches-note>
        The cards use the standard costs{a.state.crewPct > 0 ? `, less your crew's ${Math.round(a.state.crewPct * 1000) / 10}%` : ""}; a cost you type for a line counts in the plan below, not on the cards.
      </p>

      <div className="flex flex-wrap items-start gap-4 rounded-[14px] border border-ink-200 bg-white p-5" data-best>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">Find the highest profit</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Tries every way to leave, refresh or replace the parts that need work and keeps the one with the most profit {atYourPrice}, on each scope&apos;s estimated resale. It does not look at cash or months: those are shown beside it.
          </p>
          {shownBest && vs && (
            <div className="mt-3 space-y-1 text-sm text-ink-700" data-best-result>
              <p>
                <span className="font-bold text-ink-950">{scopeWords(a.base, shownBest.choices) || "Nothing beyond what is required"}</span>
              </p>
              <p>
                Profit <span className="tabular font-bold text-ink-950" data-best-profit>{money(shownBest.live.deal.profit)}</span>
                <Marks demo={demo} untested={untested} estimate={!demo} /> (<span data-best-gain>{vs.profit >= 0 ? "+" : "−"}
                {money(Math.abs(vs.profit))} on your scope now, both on each scope&apos;s estimated resale</span>) · renovation {money(shownBest.rehab)} · resale {money(shownBest.resale)} · cash needed {money(shownBest.live.cashNeeded)} (
                {vs.cash >= 0 ? "+" : "−"}
                {money(Math.abs(vs.cash))}) · margin {pct(shownBest.live.margin)}.
              </p>
              {!vs.nowOnEstimate && (
                <p className="text-xs text-ink-700" data-best-other-resale>
                  Your deal now uses {money(resaleNow)} ({a.state.resale.basis === "mine" ? "your resale" : "the resale kept"}), not your scope&apos;s estimate of {money(estimateNow)}: its profit on the card above is on that resale.
                </p>
              )}
              {shownBest.belowTypical.length > 0 && (
                <p className="text-xs font-semibold text-[#b9411d]" data-best-below-typical>
                  It rests on costs below the typical range for the work: {belowTypicalWords(shownBest.belowTypical)}.
                </p>
              )}
              <p className="text-xs text-ink-500">
                {shownBest.compared.toLocaleString("en-US")} scopes compared. The timeline stays {x.months} month{x.months === 1 ? "" : "s"}: a bigger job usually takes longer, so set the months above if it does.
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={() => setBest({ key: bestKey, best: highestProfit(a.base, x, a.state, asking) })} data-find-best>
            Find highest profit
          </button>
          {shownBest && (
            <button type="button" className="btn-accent text-sm" onClick={() => a.applyScope(shownBest.choices)} data-use-best>
              Use this scope
            </button>
          )}
        </div>
      </div>

      {a.state.reviewOpen && (
        <div className="rounded-[14px] border border-[#f0dcb4] bg-[#fff8ea] p-5 text-sm text-ink-900" role="status" data-review-resale>
          <p className="font-bold">Scope changed: review the resale.</p>
          {a.state.resale.basis === "estimate" ? (
            <p className="mt-1 text-ink-700">
              The resale is now the estimate for this scope, <span className="tabular font-bold text-ink-950">{money(resaleNow)}</span>
              <Marks demo={demo} untested={untested} estimate={!demo} />. It rests on placeholder rates for what each part adds
              {demo ? "." : `, so check it against the sold homes: similar homes, ${adjustedWords(report.arv.comps)}, sold for ${money(range.low)} to ${money(range.high)}.`}
            </p>
          ) : (
            <p className="mt-1 text-ink-700">
              {a.state.resale.basis === "mine" ? "Your resale is " : "The scope changed and the resale stays "}
              <span className="tabular font-bold text-ink-950">{money(resaleNow)}</span>. The estimate for this scope is{" "}
              <span className="tabular font-bold text-ink-950" data-review-estimate>{money(estimateNow)}</span>
              <Marks demo={demo} untested={untested} estimate={!demo} />.
            </p>
          )}
          {a.state.resale.basis === "mine" && resaleNow > a.base.fullValue + 0.5 && (
            <p className="mt-2 font-semibold text-[#b9411d]" data-review-above-full>
              Your resale is above this house&apos;s fully renovated value from the comparable sales, {money(a.base.fullValue)}. No GO rests on it: while it is in use, the verdict is CHECK FIRST at best.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {a.state.resale.basis === "estimate" ? (
              <button type="button" className="btn-secondary text-sm" onClick={a.confirmResale} data-review-confirm>
                This resale looks right
              </button>
            ) : (
              <>
                <button type="button" className="btn-accent text-sm" onClick={a.useEstimate} data-review-use-estimate>
                  Use the estimate ({money(estimateNow)})
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => {
                    setTyping(false);
                    a.confirmResale();
                  }}
                  data-review-keep
                >
                  {a.state.resale.basis === "mine" ? "Use" : "Keep"} {money(resaleNow)}
                </button>
              </>
            )}
            {typing ? (
              <div className="w-56">
                <NumberField id="advisor-my-resale" label="Your resale" unit="$" value={resaleNow} onChange={(n) => a.setMine(n)} hint="What you expect it to sell for" />
              </div>
            ) : (
              <button type="button" className="btn-secondary text-sm" onClick={() => setTyping(true)} data-review-type>
                Type my own
              </button>
            )}
          </div>
        </div>
      )}

      {/* What the chosen scope reaches, and what it leaves below par with its cost in resale (PR #10's honesty, kept
          for every scope). The analysis' own plan is called "this plan"; a scope the person chose, "this scope". */}
      <Block title={a.now.plan === a.base.analysisPlan ? "What this plan reaches" : "What this scope reaches"} demo={demo}>
        <p className="mb-3 text-sm text-ink-700">
          As-is about {money(a.now.plan.asIsValue)}. Renovation can add up to {money(a.now.plan.uplift)}
          {Number.isFinite(a.now.plan.headroom) ? `, and the block will pay for about ${money(a.now.plan.headroom)} of it` : ""}.{" "}
          <span className="font-medium text-ink-900">{a.now.plan.finishAdvice}</span>
        </p>
        <ScopeLadder
          plan={a.now.plan}
          scope={a.now.plan !== a.base.analysisPlan}
          // The deal uses the scope's estimate only when the resale is that estimate; a kept or typed resale is said apart.
          afterLabel={
            a.state.resale.basis === "analysis"
              ? undefined
              : a.state.resale.basis === "estimate"
                ? a.now.plan === a.base.analysisPlan
                  ? undefined
                  : "Resale after this scope (estimate) · the deal uses this"
                : `${a.now.plan === a.base.analysisPlan ? "Resale after this plan" : "Estimate for this scope"} · the deal uses ${money(resaleNow)}, ${a.state.resale.basis === "mine" ? "your resale" : "the resale kept"}`
          }
        />
      </Block>

      <div className="rounded-[14px] border border-ink-200 bg-white p-5 sm:p-6" data-plan-lines>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[20px] font-bold tracking-[-0.03em] text-ink-950">Make the plan yours.</p>
            <p className="mt-0.5 text-sm text-ink-500">You know your crew. Leave, refresh or replace each part, and put your own numbers in. A cost never moves the resale; a change of scope asks you to review it.</p>
          </div>
          <div className="w-52">
            <NumberField id="advisor-crew" label="My crew is cheaper by" unit="%" scale={100} value={a.state.crewPct} onChange={(n) => a.setCrew(n)} hint={`Up to ${ADVISOR_BOUNDS.crewPct.max * 100}%; lowers the costs you did not type`} />
          </div>
        </div>

        <ul className="mt-5 divide-y divide-ink-100">
          {a.now.plan.items.map((item) => (
            <PlanLine key={item.key} item={item} studio={studio} chooseable={keys.includes(item.key)} demo={demo} untested={untested} />
          ))}
        </ul>

        <div className="mt-4 space-y-1 border-t border-ink-200 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-ink-700">Renovation</span>
            <span className="tabular font-semibold text-ink-950" data-plan-subtotal>{money(a.now.cost.rehab)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-ink-700">Reserve, {(x.reserve * 100).toFixed(x.reserve * 100 % 1 ? 1 : 0)}% for what photos cannot show</span>
            <span className="tabular font-semibold text-ink-950">{money(a.now.cost.rehab * x.reserve)}</span>
          </div>
          <div className="flex justify-between gap-3 text-base">
            <span className="font-bold text-ink-950">Renovation + reserve</span>
            <span className="tabular font-bold text-ink-950" data-plan-total>
              {money(live.deal.rehabWithReserve)}
              {demo && <DemoTag className="ml-2" />}
            </span>
          </div>
          <p className="pt-1 text-xs text-ink-500">Costs are placeholder contractor rates for the Seattle area, not quotes for this house. What a part adds to the resale is estimated with placeholder rates{demo ? " on demo sales" : ", not measured from these sales"}.</p>
        </div>
      </div>
    </section>
  );
}

/** One line of the plan: leave, refresh or replace it (when it can be chosen), its cost to change, what it adds. */
function PlanLine({ item, studio, chooseable, demo, untested }: { item: PlanItem; studio: Studio; chooseable: boolean; demo: boolean; untested: boolean }) {
  const a = studio.advisor!;
  const [last, setLast] = useState<ScopeOption | null>(null);
  const option: ScopeOption = item.action === "refresh" || item.action === "replace" ? item.action : "skip";
  const on = option !== "skip";
  const cost = a.now.cost.lines.find((l) => l.key === item.key);
  const advised = a.base.advised[item.key as CategoryKey];
  const kind = item.action === "required" ? "Required" : item.action === "inspect" ? (item.costLikely > 0 ? "Not in the photos · budgeted" : "Not in the photos · check on site") : null;
  return (
    <li className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:items-center" data-plan-line={item.key} data-line-option={chooseable ? option : item.action}>
      <div className="flex min-w-0 items-start gap-3">
        {chooseable ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${item.label}: ${on ? "in the plan" : "left as it is"}`}
            onClick={() => {
              if (on) {
                setLast(option);
                a.setOption(item.key, "skip");
              } else a.setOption(item.key, last ?? (advised && advised !== "skip" ? advised : "refresh"));
            }}
            className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? "bg-ink-950" : "bg-[#9aa3a0]"}`}
            data-line-switch
          >
            <span className={`h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`} />
          </button>
        ) : (
          <span className="mt-0.5 flex h-6 w-11 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold uppercase text-ink-500" title={item.action === "required" ? "Systems are a condition of sale and stay in the plan" : "Not seen in the photos: budgeted until you see it"}>
            {item.action === "required" ? "Req" : "?"}
          </span>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-ink-950">{item.label}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {kind ?? (item.need === "none" ? "At par for the block" : item.need === "replace" ? "Needs a full replace" : "Needs a refresh")}
            {chooseable && advised && option !== advised ? ` · the analysis: ${OPTION_WORD[advised].toLowerCase()}` : ""}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-700">{item.reason}</p>
        </div>
      </div>
      <div className="min-w-0">
        {chooseable && (
          <div className="inline-flex rounded-lg border border-ink-200 bg-[#f7f8f6] p-0.5" role="group" aria-label={`${item.label}: what to do`}>
            {(["skip", "refresh", "replace"] as ScopeOption[]).map((o) => (
              <button key={o} type="button" aria-pressed={option === o} onClick={() => a.setOption(item.key, o)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${option === o ? "bg-ink-950 text-white" : "text-ink-700 hover:bg-white"}`} data-line-set={o}>
                {OPTION_WORD[o]}
              </button>
            ))}
          </div>
        )}
        {item.valueAdded > 0 && (
          <p className="mt-1.5 text-xs text-ink-700">
            Adds about <span className="tabular font-semibold text-ink-950">{money(item.valueAdded)}</span> to the resale
            <Marks demo={demo} untested={untested} estimate={!demo} />
          </p>
        )}
      </div>
      <div className="min-w-0">
        {cost ? (
          <>
            <NumberField id={`advisor-cost-${item.key}`} label={cost.edited !== null ? "Your cost" : "Cost"} unit="$" value={cost.used} onChange={(n) => a.setCost(item.key, item.action, n)} hint={`Typical ${money(item.costLow)}–${money(item.costHigh)}`} />
            {/* The owner's decision (2026-11-28): any line may be priced below the typical range, said plainly. */}
            {belowTypical([cost]).length > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-[#b9411d]" data-line-below-typical>
                {cost.edited !== null ? "Your cost" : "With your crew's discount, the cost"} is below the typical range for this work ({money(cost.costLow)}–{money(cost.costHigh)}).
              </p>
            )}
            {cost.edited !== null && (
              <button type="button" className="mt-1 text-[11px] font-semibold text-[#b9411d] underline underline-offset-2" onClick={() => a.setCost(item.key, item.action, null)} data-line-cost-reset>
                Back to {money(cost.standard)}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-500">No cost</p>
        )}
      </div>
    </li>
  );
}

/**
 * The resale of each approach against the comparable sales (the "Resale & comps" tab): how many of the sold homes, as
 * adjusted (adjustedWords), sold at or above it; on demo data, the sales by the condition they sold in.
 */
export function CompsForPlan({ studio, report, demo, untested }: { studio: Studio; report: Report; demo: boolean; untested: boolean }) {
  const a = studio.advisor;
  const x = studio.inputs;
  const asking = report.deal.purchasePrice;
  const cards = useMemo(() => (a && x ? approaches(a.base, x, a.state.crewPct, asking) : []), [a, x, asking]);
  if (!a || !x) return null;
  const comps = report.arv.comps;
  const rows = [{ label: "Your scope now", value: studio.resale, estimate: resaleIsEstimate(a.base, a.state) }, ...cards.map((c) => ({ label: c.label, value: c.resale, estimate: c.estimated }))];
  const groups = demo ? compsByCondition(comps) : [];
  return (
    <div className="rounded-[14px] border border-ink-200 bg-white p-5" data-comps-for-plan>
      <p className="text-[17px] font-bold tracking-tight text-ink-900">The resale of each approach, against the sold homes</p>
      <p className="mt-1 text-sm text-ink-500" data-comps-adjusted>Each sale is {adjustedWords(comps)}. A resale that few of them reached asks for a closer look.</p>
      <ul className="mt-3 divide-y divide-ink-100 text-sm">
        {rows.map((r) => {
          const s = compsAtOrAbove(comps, r.value);
          return (
            <li key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="font-semibold text-ink-900">{r.label}</span>
              <span className="text-ink-700">
                <span className="tabular font-semibold text-ink-950">{money(r.value)}</span>
                <Marks demo={demo} untested={untested} estimate={r.estimate && !demo} /> · {s.atOrAbove} of {s.total} similar homes sold at or above this
              </span>
            </li>
          );
        })}
      </ul>
      {groups.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-ink-700">The demo sales by the condition they sold in (adjusted to this house):</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-700">
            {groups.map((g) => (
              <li key={g.condition}>
                {g.condition}: {g.count} · middle {money(g.median)} <DemoTag />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-500">{APPROACHES.length} approaches; the adjusted prices rest on the comps&apos; own adjustments, whose rates are placeholders.</p>
    </div>
  );
}
