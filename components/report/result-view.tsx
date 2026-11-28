"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import type { DataSource } from "@/lib/data/house-data";
import type { SubjectSources } from "@/lib/listing/subject";
import { VerdictPill } from "@/components/ui/verdict";
import { DemoBanner, DemoTag, EstimateTag, UntestedBanner } from "@/components/ui/demo";
import { Icon } from "@/components/ui/icon";
import { CompsTable, DealTable, Narrative, RiskFlags, Sensitivity, SourceBlock, SubjectLine, ValueStats, WithheldNote, money } from "./report-view";
import { PlanView } from "./plan-view";
import { belowTypicalWords, resaleIsEstimate, resaleWords } from "./resale";
import { AssessmentView, ListingCard } from "./assessment-view";
import { OfferLab, SaveScenarioButton, useStudio } from "./studio";
import { AdvisorPanel, CompsForPlan } from "./advisor";
import type { OpenScenario } from "@/lib/api/scenario";
import type { DealPayload } from "@/lib/deals";
import { SaveDealButton } from "@/components/app/save-deal-button";

export interface PhotosUsed {
  uploaded: number;
  fromListing: number;
  failed: number;
  leftOut?: number;
}

export interface ResultViewProps {
  report: Report;
  plan?: RenovationPlan | null;
  assessment?: PhotoAssessment | null;
  listing?: ListingInfo | null;
  demo: boolean;
  untested: boolean;
  /** Why a demo stands where real sold prices were connected (lib/data/house-data.ts Fallback). */
  fallbackWhy?: string;
  sources?: SubjectSources;
  data?: DataSource;
  conditionFrom: "photos" | "record";
  photosUsed?: PhotosUsed | null;
  /** The person's own photos, as this browser holds them (blob: links), shown in the panel at the top. */
  previews?: string[];
  title: string;
  /** "h1" where the title is the page's own heading (a saved deal); "h2" under a page that has its own (New analysis). */
  titleAs?: "h1" | "h2";
  /** The line under the title. Without one it is said from the house: its area, rooms and size — in a demo only what
   *  the listing (or the caller) gave, never the made-up record's. */
  subtitle?: string;
  /** Quick numbers: the renovation figure the person typed, when they typed one; the deal used it instead of the
   *  condition's estimate. */
  rehabTyped?: number | null;
  /** Quick numbers: the person typed the profit target, so it is called theirs. A full analysis uses the default. */
  targetSet?: boolean;
  /** What the price beside "most you could offer" is: the listing's asking price, or the price typed in Quick numbers. */
  priceWhat?: string;
  /** Delete and the like: whatever else the page offers, top right. */
  actions?: React.ReactNode;
  /**
   * How the result is saved (Deal Studio, 2026-11-28): a new result is saved as a deal, with the person's scenario when
   * they changed anything; a saved deal saves its scenario.
   */
  save?: { kind: "new"; payload: DealPayload } | { kind: "saved"; dealId: string };
  /** A saved deal's scenario to open on (lib/api/scenario.ts readScenario). */
  scenario?: OpenScenario | null;
  back?: { href: string; label: string };
}

type TabKey = "overview" | "plan" | "comps" | "risk";

const area = (submarket: string) => (/^\d{5}$/.test(submarket) ? `zip code ${submarket}` : submarket);

/**
 * The line under the address, from the house. Real numbers: the area, rooms and size as read. A demo: only what the
 * listing (or the caller) gave — the made-up record's zip code, rooms and size are not this house's and are never put
 * under its address (the review of 2026-11-27: "zip code 98103 · 3 beds" under a Tacoma address). Null: nothing to say.
 */
function houseLine(subject: Report["subject"], sources: SubjectSources | undefined, demo: boolean): string | null {
  const words: Record<"sqft" | "beds" | "baths", string | null> = {
    beds: subject.beds !== null ? `${subject.beds} beds` : null,
    baths: subject.baths !== null ? `${subject.baths} baths` : null,
    sqft: `${subject.sqft.toLocaleString("en-US")} sqft`,
  };
  if (!demo) return [area(subject.submarket), words.beds, words.baths, words.sqft].filter(Boolean).join(" · ");
  if (!sources) return null;
  const given = (["beds", "baths", "sqft"] as const).filter((k) => sources[k] === "listing" || sources[k] === "caller").map((k) => words[k]);
  return given.length ? given.filter(Boolean).join(" · ") : null;
}

/** The person's own photos, or a quiet panel saying what was read. Listing photos are the listing's own: flip neither keeps nor shows them. */
function PhotoPanel({ previews, photosUsed, assessment, conditionFrom }: { previews?: string[]; photosUsed?: PhotosUsed | null; assessment?: PhotoAssessment | null; conditionFrom: "photos" | "record" }) {
  const [shown, setShown] = useState(0);
  const read = photosUsed ? photosUsed.uploaded + photosUsed.fromListing : 0;
  if (previews && previews.length > 0) {
    const current = previews[Math.min(shown, previews.length - 1)];
    return (
      <div className="relative min-h-[300px] overflow-hidden rounded-[15px] bg-ink-100" data-photo-panel="photos">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt="One of your photos of this house" className="absolute inset-0 h-full w-full object-cover" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-bold text-ink-900">
          <Icon name="camera" className="h-4 w-4" />
          Your photos
        </span>
        {previews.length > 1 && (
          <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] gap-2 overflow-x-auto">
            {previews.slice(0, 8).map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setShown(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-pressed={i === shown}
                className={`h-11 w-14 shrink-0 overflow-hidden rounded-md border-2 ${i === shown ? "border-white" : "border-transparent opacity-80"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="relative flex min-h-[300px] flex-col justify-end overflow-hidden rounded-[15px] bg-gradient-to-br from-[#f3f1ec] via-[#e6e3dc] to-[#d7d3ca] p-6" data-photo-panel="none">
      <Icon name="home" className="absolute -right-6 -top-4 h-56 w-56 text-white/55" strokeWidth={1} />
      <div className="relative">
        <p className="eyebrow text-[#b9411d]">{conditionFrom === "photos" ? "Read from the photos" : "No photos read"}</p>
        <p className="mt-2 max-w-sm text-lg font-bold leading-snug tracking-tight text-ink-900">
          {conditionFrom === "photos" && assessment
            ? `${assessment.overallCondition[0].toUpperCase()}${assessment.overallCondition.slice(1)} condition${read ? `, from ${read} photo${read === 1 ? "" : "s"}` : ""}.`
            : "The condition comes from the property record."}
        </p>
        <p className="mt-1.5 max-w-sm text-sm text-ink-700">Room by room, and what to fix, under Renovation budget.</p>
      </div>
    </div>
  );
}

/**
 * The target the most-to-offer was solved for, in words: the amount the deal used (a full analysis always uses the
 * default; Quick numbers the one typed, which is the person's). A deal saved before the target was kept says only
 * "the profit target".
 */
function targetWords(deal: Report["deal"], targetSet: boolean): { the: string; offerFor: string } {
  const t = deal.targetProfit;
  if (typeof t !== "number") return { the: "the profit target", offerFor: "for the profit target" };
  return targetSet ? { the: `your ${money(t)} target`, offerFor: `for your ${money(t)} profit target` } : { the: `the ${money(t)} target`, offerFor: `for a ${money(t)} profit` };
}

/**
 * The heading of the decision, in plain words, from the verdict and the numbers behind it. TIGHT has two meanings
 * (lib/engine/deal.ts): the target is met but the downside is not, or there is profit short of the target. On demo
 * numbers the heading says so.
 */
function decisionHeading(deal: Report["deal"], demo: boolean, targetSet: boolean): string {
  const { the } = targetWords(deal, targetSet);
  const t = deal.targetProfit;
  let text: string;
  if (deal.verdict === "GO") text = `The deal meets ${the} and holds on the downside.`;
  else if (deal.verdict === "PASS") text = "Not at this price: it loses money.";
  else if (deal.verdict === "TIGHT") {
    const metTarget = typeof t === "number" ? deal.profit >= t : deal.worstCaseProfit > 0 ? false : null;
    text = metTarget === true ? `It meets ${the}, but not on the downside.` : metTarget === false ? `Profitable, but short of ${the}.` : "A thin deal at this price.";
  } else text = "The numbers work. Something is still open.";
  return demo ? `On demo numbers: ${text[0].toLowerCase()}${text.slice(1)}` : text;
}

/**
 * The purchase decision (the design's Deal Studio card): the verdict, the profit left at the asking price, the most to
 * offer, the renovation, the resale value and the downside, and the profit margin (profit ÷ resale value). Every figure
 * is the report's own; in a demo each one carries DEMO.
 */
function VerdictCard({ report, analysed, changed, editable, onReset, demo, untested, targetSet }: { report: Report; analysed: Report["deal"]; changed: boolean; editable: boolean; onReset: () => void; demo: boolean; untested: boolean; targetSet: boolean }) {
  const { deal } = report;
  const atAnalysedPrice = Math.abs(deal.purchasePrice - analysed.purchasePrice) < 0.5;
  const { offerFor } = targetWords(deal, targetSet);
  // Below zero, no price reaches the target: said in words, never as a negative price.
  const noPrice = deal.maxAllowableOffer < 0;
  const label = demo ? "Demo numbers" : untested ? "Real sold prices · untested estimate" : "Estimate";
  // Margin on the resale the deal is worked out on (deal.arv: after the plan, or fully renovated).
  const margin = deal.arv > 0 ? `${((deal.profit / deal.arv) * 100).toFixed(1)}%` : "—";
  const resale = resaleWords(deal);
  return (
    <div className="rounded-[14px] border border-ink-200 bg-white p-5 sm:p-7" data-verdict-card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500" data-card-eyebrow>{changed ? "Your scenario" : "Your purchase decision"}</p>
          <p className="mt-2 text-[22px] font-bold leading-snug tracking-[-0.035em] text-ink-950 sm:text-[26px]" data-decision-heading>
            {decisionHeading(deal, demo, targetSet)}
          </p>
        </div>
        <VerdictPill verdict={deal.verdict} demo={demo} untested={untested} />
      </div>
      {/* The design's four-number row: the most to offer in the dark cell, then profit, margin and the renovation. */}
      <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-[10px] border border-[#dce4de] bg-[#f4f7f3] lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-2 bg-ink-950 p-4 text-white sm:p-5" data-card-row="Most you could offer">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[#c3ccd0]">
            Maximum buy price
            {demo && <DemoTag />}
          </span>
          <strong className="tabular text-[26px] font-bold leading-tight tracking-[-0.05em] sm:text-[34px]">{noPrice ? "None" : money(deal.maxAllowableOffer)}</strong>
          <small className="text-xs text-[#c3ccd0]">{noPrice ? `No price works ${offerFor}` : offerFor[0].toUpperCase() + offerFor.slice(1)}</small>
        </div>
        <div className="flex min-w-0 flex-col gap-2 border-l border-[#dce4de] p-4 sm:p-5">
          <span className="text-sm font-semibold text-ink-700">Potential net profit</span>
          <strong className={`tabular text-[26px] font-bold leading-tight tracking-[-0.05em] sm:text-[34px] ${deal.profit < 0 ? "text-pass" : "text-ink-950"}`} data-verdict-profit>
            {money(deal.profit)}
            {demo && <DemoTag className="ml-2 align-middle" />}
          </strong>
          <small className="text-xs text-ink-500">
            {atAnalysedPrice ? "At the asking price" : `At your price of ${money(deal.purchasePrice)}`}, after every project cost, before tax{Number.isNaN(deal.roi) ? "" : `. ${Math.round(deal.roi * 100)}% return on the cash you put in`}.
          </small>
        </div>
        <div className="flex min-w-0 flex-col gap-2 border-t border-[#dce4de] p-4 sm:p-5 lg:border-l lg:border-t-0">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-700">
            Profit margin
            {demo && <DemoTag />}
          </span>
          <strong className="tabular text-[26px] font-bold leading-tight tracking-[-0.05em] text-ink-950 sm:text-[34px]" data-profit-margin>
            {margin}
          </strong>
          <small className="text-xs text-ink-500">Profit ÷ resale value</small>
        </div>
        <div className="flex min-w-0 flex-col gap-2 border-l border-t border-[#dce4de] p-4 sm:p-5 lg:border-t-0" data-card-row="Renovation + reserve">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-700">
            Renovation + reserve
            {demo && <DemoTag />}
          </span>
          <strong className="tabular text-[26px] font-bold leading-tight tracking-[-0.05em] text-ink-950 sm:text-[34px]">{money(deal.rehabWithReserve)}</strong>
          <small className="text-xs text-ink-500">The work and a reserve for what photos cannot show</small>
        </div>
      </div>
      {/* Under the row, as the design's line under its numbers: the downside, and what the value rests on. */}
      {/* Two columns and a full-width line under them: three columns squeezed the last into one word a line once the
          resale value gained its note (PR #10). */}
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap items-baseline gap-x-2" data-card-row="Downside profit">
          <dt className="flex items-center gap-1.5 text-ink-700">
            <Icon name="info" className="h-4 w-4 text-ink-500" />
            Downside profit (resale 10% lower, the work 20% higher)
            {demo && <DemoTag />}
          </dt>
          <dd className={`tabular font-bold ${deal.worstCaseProfit < 0 ? "text-pass" : "text-ink-950"}`}>{money(deal.worstCaseProfit)}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2" data-card-row="Resale value" data-resale-basis={deal.resaleBasis ?? "saved"}>
          <dt className="flex items-center gap-1.5 text-ink-700">
            {resale.label}
            {demo ? <DemoTag /> : resaleIsEstimate(deal) && <EstimateTag />}
          </dt>
          <dd className="tabular font-bold text-ink-950">{money(deal.arv)}</dd>
          {resale.note && <span className="basis-full text-xs text-ink-500" data-resale-note>{resale.note}</span>}
        </div>
        {/* The owner's decision (2026-11-28): a cost below the typical range is allowed, and said plainly here. */}
        {deal.costsBelowTypical && deal.costsBelowTypical.length > 0 && (
          <p className="text-sm font-semibold text-[#b9411d] sm:col-span-2" data-card-below-typical>
            Your cost is below the typical range for this work: {belowTypicalWords(deal.costsBelowTypical)}.
          </p>
        )}
        <p className="text-xs text-ink-500 sm:col-span-2">
          {label} · buying and selling costs, loan interest and holding costs included
        </p>
      </dl>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-200 pt-4 text-sm" data-as-analyzed>
          {changed ? (
            <>
              <span className="text-ink-700">
                As analyzed: <span className="font-bold text-ink-950">{analysed.verdict}</span> · {money(analysed.profit)} profit at {money(analysed.purchasePrice)} · maximum buy price {analysed.maxAllowableOffer < 0 ? "none" : money(analysed.maxAllowableOffer)}
                {demo && <DemoTag className="ml-2 align-middle" />}
              </span>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs sm:ml-auto" onClick={onReset} data-studio-reset>
                Reset to the analysis
              </button>
            </>
          ) : (
            <span className="text-ink-500">The analysis&apos; own numbers. Change the price, the timeline, the assumptions or the renovation below to work the deal again.</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Four tabs in the design's style; the keyboard's arrow keys move between them. */
function Tabs({ id, tabs, active, onChange }: { id: string; tabs: { key: TabKey; label: string; count?: number }[]; active: TabKey; onChange: (key: TabKey) => void }) {
  return (
    <div role="tablist" aria-label="Parts of the analysis" className="flex gap-7 overflow-x-auto border-b border-ink-200">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          id={`${id}-${t.key}`}
          role="tab"
          type="button"
          aria-selected={active === t.key}
          aria-controls={`${id}-${t.key}-panel`}
          tabIndex={active === t.key ? 0 : -1}
          data-tab={t.key}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            const to = { ArrowRight: i + 1, ArrowLeft: i - 1 + tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
            if (to === undefined) return;
            e.preventDefault();
            const next = tabs[to % tabs.length];
            onChange(next.key);
            document.getElementById(`${id}-${next.key}`)?.focus();
          }}
          className={`-mb-px flex items-center whitespace-nowrap border-b-2 px-0.5 pb-3.5 text-sm transition-colors ${active === t.key ? "border-orange font-bold text-ink-950" : "border-transparent font-medium text-ink-500 hover:text-ink-900"}`}
        >
          {t.label}
          {typeof t.count === "number" && t.count > 0 && <span className="ml-1.5 rounded bg-[#fff0d8] px-1.5 py-0.5 text-xs text-[#aa792b]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * One analysis, as the design lays it out: the house, its photos and the purchase decision, the asking price beside
 * the most to offer, then Overview, Renovation plan, Comparable sales and Risk check. Every honesty mark the report
 * carries (DEMO, UNTESTED, where each fact came from) is kept where it was.
 */
export function ResultView(p: ResultViewProps) {
  const { report, demo, untested } = p;
  // Deal Studio: the deal worked again in the browser as the person changes the price, the timeline, the assumptions
  // or (where the result has a plan) the renovation scope.
  const studio = useStudio(report, demo, p.scenario, p.plan);
  // Where there is a renovation advisor, it is the first tab and opens first, as in the design (the scope is the core
  // of the deal); otherwise the full deal math.
  const [tab, setTab] = useState<TabKey>(studio.advisor ? "plan" : "overview");
  const tabsId = useId();
  const panel = (key: TabKey) => ({ id: `${tabsId}-${key}-panel`, role: "tabpanel", "aria-labelledby": `${tabsId}-${key}`, tabIndex: 0, hidden: tab !== key, "data-panel": key });
  const shown = studio.shown;
  // A new result once saved: the deal it became, and the scenario it holds (null: the analysis' own numbers).
  const [savedAs, setSavedAs] = useState<{ id: string; kept: OpenScenario | null } | null>(null);
  const Title = p.titleAs ?? "h2";
  const subject = report.subject;
  const subtitle = p.subtitle ?? houseLine(subject, p.sources, demo);
  // Where the listing and the public record disagree, the result says so before anything else (as the Overview and
  // the landing page promise); the flag stays in Risk check too.
  const differs = report.riskFlags.filter((f) => f.code === "RECORD_DIFFERS");
  // Quick numbers with a renovation figure typed: the engine flags a condition-priced renovation only when no figure
  // was given (lib/engine/evaluate.ts, REHAB_FROM_CONDITION), so a saved deal knows it too, without the figure itself.
  const rehabGiven = typeof p.rehabTyped === "number" || !report.riskFlags.some((f) => f.code === "REHAB_FROM_CONDITION");
  const tabs: { key: TabKey; label: string; count?: number }[] = studio.advisor
    ? [
        { key: "plan", label: "Renovation budget" },
        { key: "comps", label: "Resale & comps" },
        { key: "overview", label: "Full deal math" },
        { key: "risk", label: "Property checks", count: report.riskFlags.length },
      ]
    : [
        { key: "overview", label: "Full deal math" },
        { key: "plan", label: "Renovation budget" },
        { key: "comps", label: "Resale & comps" },
        { key: "risk", label: "Property checks", count: report.riskFlags.length },
      ];

  return (
    <section className="space-y-6" data-result>
      {p.back && (
        <Link href={p.back.href} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-950">
          <Icon name="chevron-left" className="h-4 w-4" />
          {p.back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Title className="text-[28px] font-bold leading-tight tracking-[-0.04em] text-ink-900 sm:text-[30px]" data-result-title>
            {p.title}
          </Title>
          {subtitle && (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-500" data-result-subtitle>
              <Icon name="pin" className="h-4 w-4" />
              {subtitle}
            </p>
          )}
        </div>
        {(p.actions || p.save?.kind === "new") && (
          <div className="flex flex-wrap items-center gap-2.5">
            {p.save?.kind === "new" && <SaveDealButton payload={p.save.payload} scenario={studio.changed ? studio.toSave() : null} current={studio.inputs ? { inputs: studio.inputs, advisor: studio.advisor ? studio.advisor.state : null } : null} onSaved={(id, kept) => setSavedAs({ id, kept })} />}
            {p.actions}
          </div>
        )}
      </div>

      {demo ? <DemoBanner kind={p.conditionFrom === "record" ? "quick" : "analysis"} why={p.fallbackWhy} /> : untested ? <UntestedBanner /> : null}

      <VerdictCard report={shown} analysed={report.deal} changed={studio.changed} editable={studio.editable} onReset={studio.reset} demo={demo} untested={untested} targetSet={p.targetSet ?? false} />

      <OfferLab studio={studio} report={report} demo={demo} priceWhat={p.priceWhat ?? "What the listing asks"} />
      <WithheldNote reasons={shown.deal.withheld} />
      {differs.map((f, i) => (
        <div key={i} className="flex gap-3 rounded-[14px] border border-[#f0dcb4] bg-[#fff8ea] p-4 text-sm leading-relaxed text-ink-900" data-record-differs>
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-tight" />
          <p>{f.message}</p>
        </div>
      ))}

      <section className="rounded-[14px] border border-ink-200 bg-white p-5 sm:p-7" data-renovation-section>
        <p className="kicker text-ink-500">See the renovation</p>
        <h3 className="mt-3 text-[24px] font-bold tracking-[-0.04em] text-ink-950">The numbers. And the house.</h3>
        <p className="mt-1 text-sm text-ink-500">{p.conditionFrom === "photos" ? "Your photos, and what was read from them; the room-by-room plan is under Renovation budget." : "No photos were read for this one: the condition comes from the property record."}</p>
        <div className="mt-5">
          <PhotoPanel previews={p.previews} photosUsed={p.photosUsed} assessment={p.assessment} conditionFrom={p.conditionFrom} />
        </div>
      </section>

      <Tabs id={tabsId} tabs={tabs} active={tab} onChange={setTab} />

      <div {...panel("overview")} className="space-y-8">
        <div className="flex gap-4 rounded-[14px] border border-[#f4d9cd] bg-[#fff1ea] p-5">
          <Icon name="sparkle" className="mt-0.5 h-6 w-6 text-[#b9411d]" />
          <div>
            <p className="font-bold text-ink-900" data-deciding>
              {shown.deal.decidingFactor}
            </p>
            {p.plan?.finishAdvice && <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{p.plan.finishAdvice}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <DealTable report={shown} demo={demo} />
          <Sensitivity report={shown} demo={demo} />
        </div>
        {studio.changed && (
          <p className="text-sm text-ink-500" data-narrative-as-analyzed>
            The reasons below are the analysis&apos; own, at its price ({money(report.deal.purchasePrice)}) and its assumptions.
          </p>
        )}
        <Narrative report={report} demo={demo} />
        {p.listing && (
          <div className="space-y-2">
            <h3 className="text-[17px] font-bold tracking-tight text-ink-900">What the listing says</h3>
            <ListingCard listing={p.listing} />
          </div>
        )}
        {p.photosUsed && (
          <p className="text-sm text-ink-500" data-photos-used>
            Looked at {p.photosUsed.uploaded + p.photosUsed.fromListing} photos
            {p.photosUsed.uploaded ? ` · ${p.photosUsed.uploaded} uploaded` : ""}
            {p.photosUsed.fromListing ? ` · ${p.photosUsed.fromListing} from the listing` : ""}
            {p.photosUsed.failed ? ` · ${p.photosUsed.failed} could not be fetched` : ""}
            {p.photosUsed.leftOut ? ` · ${p.photosUsed.leftOut} left out to stay under the size the photo reading takes` : ""}.
          </p>
        )}
      </div>

      <div {...panel("plan")} className="space-y-8">
        {studio.advisor && <AdvisorPanel studio={studio} report={report} demo={demo} untested={untested} />}
        {p.assessment && <AssessmentView assessment={p.assessment} />}
        {studio.advisor ? null : p.plan ? (
          <PlanView plan={p.plan} demo={demo} untested={untested} />
        ) : (
          <div className="card p-5 text-sm leading-relaxed text-ink-700" data-plan-none>
            {rehabGiven ? (
              <>
                No photos were read for this one, so there is no room-by-room plan. The deal uses the renovation you entered
                {typeof p.rehabTyped === "number" ? `, ${money(p.rehabTyped)},` : ""} plus a reserve for what photos cannot show: {money(shown.deal.rehabWithReserve)} in all{studio.changed && Math.abs(shown.deal.rehabWithReserve - report.deal.rehabWithReserve) >= 0.5 ? ` with your reserve (as analyzed ${money(report.deal.rehabWithReserve)})` : ""}. From the condition on record it would be {money(report.rehab.low)} to {money(report.rehab.high)}, likely {money(report.rehab.likely)}.
              </>
            ) : (
              <>
                No photos were read for this one, so there is no room-by-room plan. The renovation is priced from the condition on record: {money(report.rehab.low)} to {money(report.rehab.high)}, likely {money(report.rehab.likely)}.
              </>
            )}
            {demo && <DemoTag className="ml-2" />}
          </div>
        )}
      </div>

      <div {...panel("comps")} className="space-y-8">
        <div className="space-y-4">
          <div>
            <h3 className="text-[17px] font-bold tracking-tight text-ink-900">See what supports the resale.</h3>
            <p className="mt-1 text-sm text-ink-500">The house as it was read, the value drawn from homes like it that sold, and every adjustment.</p>
          </div>
          <SubjectLine subject={subject} sources={p.sources} conditionFrom={p.conditionFrom} demo={demo} record={p.data?.name} />
          <ValueStats report={shown} demo={demo} untested={untested} analysed={studio.changed ? report.deal : undefined} />
        </div>
        {studio.advisor && <CompsForPlan studio={studio} report={report} demo={demo} untested={untested} />}
        {p.data && <SourceBlock data={p.data} />}
        <CompsTable report={report} demo={demo} />
      </div>

      <div {...panel("risk")} className="space-y-5">
        <div>
          <h3 className="text-[17px] font-bold tracking-tight text-ink-900">Check the details that change the deal.</h3>
          <p className="mt-1 text-sm text-ink-500">What came up in the listing, the photos and the record. Each one is worth an answer before you offer.</p>
        </div>
        <RiskFlags report={report} demo={demo} />
      </div>

      {studio.editable && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[14px] border border-ink-200 bg-white px-5 py-4" data-scenario-bar>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500">Potential net profit{studio.changed ? " · your scenario" : ""}</p>
            <p className={`tabular text-2xl font-bold tracking-tight ${shown.deal.profit < 0 ? "text-pass" : "text-ink-950"}`} data-bar-profit>
              {money(shown.deal.profit)}
              {demo && <DemoTag className="ml-2 align-middle" />}
            </p>
          </div>
          <p className="text-sm text-ink-500 sm:max-w-sm" data-bar-note>
            {studio.advisor
              ? `Your price, your scope, your timeline and assumptions, in one place. ${studio.advisor.state.resale.basis === "analysis" ? "The resale value stays the analysis'." : "The resale is the one set under Renovation budget."}`
              : "Your price, your timeline, your assumptions, in one place. The resale value stays the analysis'."}
          </p>
          <div className="sm:ml-auto">
            {p.save?.kind === "saved" ? (
              <SaveScenarioButton dealId={p.save.dealId} studio={studio} kept={p.scenario ?? null} />
            ) : savedAs ? (
              <SaveScenarioButton key={savedAs.id} dealId={savedAs.id} studio={studio} kept={savedAs.kept} />
            ) : p.save?.kind === "new" ? (
              <p className="text-sm text-ink-500" data-bar-save-hint>{studio.changed ? "Save the deal (top right) to keep this scenario." : "Save the deal (top right) to keep it."}</p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
