"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { costsAt, evaluateDeal } from "@/lib/engine/deal";
import { DEFAULT_DEAL_TERMS } from "@/lib/engine/defaults";
import type { DealInputs, DealResult } from "@/lib/engine/types";

/*
 * The landing page's sample deal (the light edition's "SAMPLE DATA · Illustrative scenario"): one made-up house, three
 * sample renovation strategies, a purchase-price slider and a crew-cost toggle. Only the inputs below are hand-picked;
 * every number shown is RenoFlip's own engine (lib/engine) with its default terms: the most to offer, the verdict,
 * the profit, the downside (resale −10%, renovation +20%) and what one more month of holding and loan costs does to it.
 * It is a sample: nothing here is a real house, and a real report today prices one plan from the listing's photos.
 */

interface Strategy {
  id: "cosmetic" | "ready" | "premium";
  name: string;
  /** The sample's work, before RenoFlip's reserve for what photos cannot show. */
  rehab: number;
  /** The sample's resale value after that work. */
  arv: number;
  /** The sample's hold, purchase to sale. */
  months: number;
}

const STRATEGIES: Strategy[] = [
  { id: "cosmetic", name: "Cosmetic", rehab: 35_000, arv: 595_000, months: 3 },
  { id: "ready", name: "Market-ready", rehab: 58_000, arv: 635_000, months: 5 },
  { id: "premium", name: "Premium", rehab: 97_000, arv: 655_000, months: 7 },
];
/** Where the slider starts: with RenoFlip's default terms, the market-ready sample's downside is just positive here. */
const START_PRICE = 410_000;
const MIN = 350_000;
const MAX = 500_000;
const CREW = 0.85;

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const signed = (n: number) => `${n < 0 ? "−" : ""}${money(n)}`;
const short = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1000).toFixed(1)}k`;

interface Scenario {
  strategy: Strategy;
  terms: DealInputs;
  deal: DealResult;
  /** The work as entered, and the reserve RenoFlip adds to it. */
  rehab: number;
  reserve: number;
  /** Profit with resale 10% lower and the work (with its reserve) 20% higher: the report's stress test. */
  downside: number;
  /** What one more month of holding and loan interest costs in that downside, and what is left after it. */
  monthCost: number;
  downsideLater: number;
}

function scenario(price: number, strategy: Strategy, crew: boolean): Scenario {
  const rehab = Math.round(strategy.rehab * (crew ? CREW : 1));
  const terms: DealInputs = { ...DEFAULT_DEAL_TERMS, askingPrice: price, rehab, holdingMonths: strategy.months };
  const deal = evaluateDeal(strategy.arv, terms);
  const downArv = strategy.arv * 0.9;
  const downRehab = deal.rehabWithReserve * 1.2;
  const downside = costsAt(price, downArv, downRehab, terms).profit;
  const downsideLater = costsAt(price, downArv, downRehab, { ...terms, holdingMonths: strategy.months + 1 }).profit;
  return { strategy, terms, deal, rehab, reserve: deal.rehabWithReserve - rehab, downside, monthCost: downside - downsideLater, downsideLater };
}

interface Sample {
  price: number;
  setPrice: (n: number) => void;
  plan: Strategy["id"];
  setPlan: (id: Strategy["id"]) => void;
  crew: boolean;
  setCrew: (on: boolean) => void;
}

const SampleContext = createContext<Sample | null>(null);

function useSample(): Sample {
  const s = useContext(SampleContext);
  if (!s) throw new Error("the sample deal is used outside its provider");
  return s;
}

/** Holds the sample's choices, so the panel at the top and the strategies further down move together. */
export function SampleDealProvider({ children }: { children: React.ReactNode }) {
  const [price, setPrice] = useState(START_PRICE);
  const [plan, setPlan] = useState<Strategy["id"]>("ready");
  const [crew, setCrew] = useState(false);
  return <SampleContext.Provider value={{ price, setPrice, plan, setPlan, crew, setCrew }}>{children}</SampleContext.Provider>;
}

const FIT: Record<string, { word: string; tone: string }> = {
  GO: { word: "Meets the target", tone: "text-[#2f6b3a]" },
  TIGHT: { word: "Thin: a test fails", tone: "text-[#9a5b12]" },
  PASS: { word: "A loss at this price", tone: "text-[#b3332a]" },
};

/** The light edition's sample panel: the four numbers, the assumptions, "What would you pay?", the extra month. */
export function SampleDealPanel({ cta }: { cta: { href: string; label: string } }) {
  const { price, setPrice, plan, crew } = useSample();
  const s = scenario(price, STRATEGIES.find((x) => x.id === plan) ?? STRATEGIES[1], crew);
  const { deal } = s;
  const fit = FIT[deal.verdict] ?? FIT.TIGHT;
  const gap = deal.maxAllowableOffer - price;
  const limitAt = Math.max(0, Math.min(100, ((deal.maxAllowableOffer - MIN) / (MAX - MIN)) * 100));
  const metrics = [
    { k: "Maximum buy price", v: deal.maxAllowableOffer < 0 ? "None" : money(deal.maxAllowableOffer), note: deal.maxAllowableOffer < 0 ? `No price works for a ${money(s.terms.targetProfit)} profit` : `For a ${money(s.terms.targetProfit)} profit`, hook: "max" },
    { k: "Financial fit", v: fit.word, note: "Profit target + downside test", hook: "fit", tone: fit.tone, word: true },
    { k: "Net profit margin", v: deal.arv > 0 ? `${((deal.profit / deal.arv) * 100).toFixed(1)}%` : "—", note: "Pre-tax profit ÷ resale value", hook: "margin" },
    { k: "Potential net profit", v: signed(deal.profit), note: deal.profit > 0 ? "After every project cost · before tax" : "A loss, after every project cost", hook: "profit", tone: deal.profit > 0 ? "text-[#b9411d]" : "text-[#a3241b]" },
  ];
  const insight =
    s.downside <= 0
      ? { title: "The downside loses money.", detail: `With resale 10% lower and the work 20% higher, the sample loses ${money(s.downside)}.` }
      : s.downsideLater <= 0
        ? { title: "One extra month could erase the downside cushion.", detail: `Resale −10% and renovation +20% leave ${money(s.downside)}. One more month adds ${money(s.monthCost)} in holding and loan costs, leaving ${signed(s.downsideLater)}.` }
        : { title: "The downside holds, even a month late.", detail: `Resale −10% and renovation +20% leave ${money(s.downside)}. One more month adds ${money(s.monthCost)} in holding and loan costs, leaving ${signed(s.downsideLater)}.` };
  return (
    <section id="deal" className="scroll-mt-6 overflow-hidden rounded-[18px] border border-[#e0e4e9] bg-white shadow-[0_16px_45px_#25344b0a]" aria-label="A sample deal" data-sample-deal>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-[#edf0f4] px-5 py-4 text-sm sm:px-6">
        <div className="flex items-center gap-3">
          <span className="h-[7px] w-[7px] rounded-full bg-orange" aria-hidden />
          <strong className="font-bold">A sample house</strong>
          <span className="text-xs text-[#626a77]">Illustrative scenario</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-[4px] border border-[#dfdce7] bg-[#f5f3f8] px-2 py-1 text-xs font-bold tracking-[0.05em] text-[#5f5871]" data-sample-tag>
            SAMPLE DATA
          </span>
          <span className="hidden text-xs text-[#626a77] sm:inline">Financial fit, before you commit</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 pb-6 pt-6 sm:px-6 lg:grid-cols-4">
        {metrics.map((m, i) => (
          <div key={m.k} className={`relative flex min-w-0 flex-col items-start gap-1.5 ${i % 2 === 1 ? "before:absolute before:-left-3 before:inset-y-1 before:w-px before:bg-[#e9edf1]" : ""} ${i === 2 ? "lg:before:absolute lg:before:-left-3 lg:before:inset-y-1 lg:before:w-px lg:before:bg-[#e9edf1]" : ""}`} data-sample-metric={m.hook}>
            <span className="text-sm text-[#5d6574]">{m.k}</span>
            <strong className={`tabular font-semibold leading-tight ${m.word ? "text-[22px] tracking-[-0.03em] sm:text-[26px]" : "text-[28px] tracking-[-0.05em] sm:text-[40px]"} ${m.tone ?? "text-[#141820]"}`}>{m.v}</strong>
            <small className="text-xs text-[#6a7280]">{m.note}</small>
          </div>
        ))}
      </div>
      <div className="mx-5 grid grid-cols-1 gap-4 border-t border-[#edf0f4] py-5 sm:mx-6 sm:grid-cols-[1fr_1fr_1.6fr] sm:items-center">
        <div>
          <span className="text-sm text-[#5d6574]">Renovation</span>
          <strong className="tabular mt-0.5 block text-lg font-semibold" data-sample-renovation>{money(s.rehab)}</strong>
          <small className="text-xs text-[#6a7280]">Plus {money(s.reserve)} reserve for what photos cannot show</small>
        </div>
        <div>
          <span className="text-sm text-[#5d6574]">Resale value</span>
          <strong className="tabular mt-0.5 block text-lg font-semibold" data-sample-arv>{money(deal.arv)}</strong>
          <small className="text-xs text-[#6a7280]">{s.strategy.months}-month hold</small>
        </div>
        <p className="text-xs leading-relaxed text-[#626a77] sm:text-right">The financial fit describes these sample numbers only. It does not check a house.</p>
      </div>
      <div className="mx-5 grid grid-cols-1 gap-6 border-t border-[#edf0f4] py-5 sm:mx-6 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <label htmlFor="sample-price" className="font-semibold">
              What would you pay?
            </label>
            <button type="button" onClick={() => setPrice(START_PRICE)} className="text-xs text-[#5d6574] underline underline-offset-4">
              Reset sample
            </button>
          </div>
          <div className="relative mt-4 flex h-[22px] items-center">
            <input id="sample-price" type="range" min={MIN} max={MAX} step={1_000} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="relative z-10 w-full cursor-ew-resize" aria-valuetext={money(price)} data-sample-price />
            <span className="pointer-events-none absolute top-0.5 h-5 border-l border-dashed border-[#282e39]" style={{ left: `${limitAt}%` }} aria-hidden />
          </div>
          <div className="mt-1.5 flex justify-between gap-2 text-xs text-[#6a7280]">
            <span>{money(MIN)}</span>
            <span className="text-center font-medium text-[#4d5868]" data-sample-gap>
              {gap >= 0 ? `${money(gap)} below the most you can offer` : `${money(gap)} above the most you can offer`}
            </span>
            <span>{money(MAX)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 items-center gap-6">
          <div>
            <span className="text-sm text-[#5d6574]">Sample purchase price</span>
            <strong className="tabular mt-0.5 block text-[22px] font-semibold tracking-tight">{money(price)}</strong>
          </div>
          <div>
            <span className="text-sm text-[#5d6574]">Downside profit</span>
            <strong className={`tabular mt-0.5 block text-[22px] font-semibold tracking-tight ${s.downside <= 0 ? "text-[#a3241b]" : ""}`} data-sample-downside>
              {signed(s.downside)}
            </strong>
            {s.downside <= 0 && <small className="text-xs font-semibold text-[#a3241b]">A loss</small>}
          </div>
        </div>
      </div>
      <div className="flex gap-3 border-t border-[#e8e3dc] bg-[#f6f4f0] px-5 py-4 text-sm sm:px-6" data-sample-month>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#8b8f98] text-xs font-bold text-[#4d5360]" aria-hidden>
          !
        </span>
        <div>
          <strong className="font-semibold">{insight.title}</strong>
          <p className="mt-0.5 text-[#565e6b]">{insight.detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f4] px-5 py-3.5 text-xs text-[#626a77] sm:px-6">
        <span>Resale −10% and renovation +20% in the downside. Sample inputs, worked out by RenoFlip&apos;s own engine: no real listing or market data.</span>
        <Link href={cta.href} className="font-bold text-[#141820] underline-offset-4 hover:underline">
          {cta.label}
        </Link>
      </div>
    </section>
  );
}

/** "More renovation. Or more return?": the three sample strategies and the crew toggle, moving the panel above. */
export function StrategyChooser() {
  const { price, plan, setPlan, crew, setCrew } = useSample();
  const all = STRATEGIES.map((st) => scenario(price, st, crew));
  const best = all.reduce((a, b) => (a.deal.profit > b.deal.profit ? a : b));
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16" data-strategies>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b9411d]">The work that earns its place</p>
        <h2 className="mt-4 text-[40px] font-semibold leading-[1.08] tracking-[-0.055em] text-[#141820] sm:text-[52px]">
          More renovation.
          <br />
          <span className="text-[#7a818d]">Or more return?</span>
        </h2>
        <p className="mt-5 max-w-md leading-relaxed text-[#596170]">The best-looking plan is not always the best-performing one. Compare the scope, the time and the money left at the end.</p>
        <button type="button" aria-pressed={crew} onClick={() => setCrew(!crew)} className="mt-6 inline-flex items-center gap-3 text-sm font-semibold text-[#141820]" data-sample-crew>
          <span className={`relative h-5 w-9 rounded-full transition-colors ${crew ? "bg-orange" : "bg-[#7f8794]"}`} aria-hidden>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${crew ? "left-[18px]" : "left-0.5"}`} />
          </span>
          Try sample crew costs −15%
        </button>
        <p className="mt-2 text-xs text-[#626a77]">Same scope, lower cost. The resale value stays the same.</p>
      </div>
      <div>
        <div className="flex justify-between gap-4 border-b border-[#dfe3e8] pb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#626a77]">
          <span>Choose a sample strategy</span>
          <span className="normal-case tracking-normal">The sample above moves with it</span>
        </div>
        <div className="divide-y divide-[#e6e9ee]">
          {all.map((x) => {
            const on = x.strategy.id === plan;
            return (
              <button
                key={x.strategy.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPlan(x.strategy.id)}
                className={`relative grid w-full grid-cols-[1.4fr_1fr_1fr] items-center gap-3 px-1 py-5 text-left ${on ? "" : "hover:bg-white/60"}`}
                data-sample-plan={x.strategy.id}
              >
                <span className="min-w-0">
                  <strong className={`flex items-center gap-2 text-[17px] font-bold ${on ? "text-[#b9411d]" : "text-[#141820]"}`}>
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-orange" aria-hidden />}
                    {x.strategy.name}
                  </strong>
                  <small className="text-xs text-[#626a77]">
                    {x.strategy.months} months · {x.strategy.id === best.strategy.id ? "Highest sample profit" : "Compare the trade-off"}
                  </small>
                </span>
                <span>
                  <small className="block text-xs text-[#626a77]">Renovation</small>
                  <strong className="tabular text-lg font-semibold">{short(x.rehab)}</strong>
                </span>
                <span>
                  <small className="block text-xs text-[#626a77]">Potential profit</small>
                  <strong className={`tabular text-lg font-semibold ${x.deal.profit <= 0 ? "text-[#a3241b]" : ""}`}>
                    {short(x.deal.profit)}
                    {x.deal.profit <= 0 && <small className="ml-1 text-xs font-semibold">loss</small>}
                  </strong>
                </span>
                <i className="absolute inset-x-1 bottom-0 h-[3px] overflow-hidden rounded-full bg-[#eceff3]" aria-hidden>
                  <b className={`block h-full ${on ? "bg-orange" : "bg-[#a9b0bb]"}`} style={{ width: `${Math.max(2, Math.min(100, (x.deal.profit / Math.max(1, best.deal.profit)) * 100))}%` }} />
                </i>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[#626a77]">A sample: each strategy changes the sample&apos;s work, resale value and hold together, and the crew discount is illustrative. A report today prices one plan from the listing&apos;s photos.</p>
      </div>
    </div>
  );
}
