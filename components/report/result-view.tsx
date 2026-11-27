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
import { DemoBanner, DemoTag, UntestedBanner } from "@/components/ui/demo";
import { Icon } from "@/components/ui/icon";
import { CompsTable, DealTable, Narrative, RiskFlags, Sensitivity, SourceBlock, SubjectLine, ValueStats, WithheldNote, money } from "./report-view";
import { PlanView } from "./plan-view";
import { AssessmentView, ListingCard } from "./assessment-view";

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
  /** What the price beside "most you could offer" is: the listing's asking price, or the price typed in Quick numbers. */
  priceWhat?: string;
  /** Save, delete: whatever the page offers, top right. */
  actions?: React.ReactNode;
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
      <div className="relative min-h-[260px] overflow-hidden rounded-[15px] bg-ink-100" data-photo-panel="photos">
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
    <div className="relative flex min-h-[260px] flex-col justify-end overflow-hidden rounded-[15px] bg-gradient-to-br from-[#e9f1e7] via-[#dce8d9] to-[#c9dbc5] p-6" data-photo-panel="none">
      <Icon name="home" className="absolute -right-6 -top-4 h-56 w-56 text-white/55" strokeWidth={1} />
      <div className="relative">
        <p className="eyebrow text-[#5f7b55]">{conditionFrom === "photos" ? "Read from the photos" : "No photos read"}</p>
        <p className="mt-2 max-w-sm text-lg font-bold leading-snug tracking-tight text-ink-900">
          {conditionFrom === "photos" && assessment
            ? `${assessment.overallCondition[0].toUpperCase()}${assessment.overallCondition.slice(1)} condition${read ? `, from ${read} photo${read === 1 ? "" : "s"}` : ""}.`
            : "The condition comes from the property record."}
        </p>
        <p className="mt-1.5 max-w-sm text-sm text-ink-700">Room by room, and what to fix, under Renovation plan.</p>
      </div>
    </div>
  );
}

/** The dark green card: the verdict, what is left at the asking price, and the three numbers it rests on. */
function VerdictCard({ report, demo, untested }: { report: Report; demo: boolean; untested: boolean }) {
  const { deal, arv } = report;
  const label = demo ? "Demo numbers" : untested ? "Real sold prices · untested estimate" : "Estimate";
  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-[15px] bg-ink-950 p-6 text-white sm:p-7" data-verdict-card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VerdictPill verdict={deal.verdict} demo={demo} untested={untested} />
        <span className="text-xs text-[#b2cbc0]">{label}</span>
      </div>
      <div className="mt-6">
        <p className="text-[13px] font-semibold text-[#bed2c8]">Profit at the asking price, before tax</p>
        <p className={`tabular mt-1 text-[44px] font-bold leading-none tracking-[-0.04em] sm:text-5xl ${deal.profit < 0 ? "text-[#f4c7c2]" : "text-white"}`} data-verdict-profit>
          {money(deal.profit)}
          {demo && <DemoTag className="ml-3 align-middle" />}
        </p>
        <p className="mt-2 text-[13px] text-[#c0d5c8]">{Number.isNaN(deal.roi) ? "Before income tax." : `${Math.round(deal.roi * 100)}% return on the cash you put in. Before income tax.`}</p>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
        {[
          { k: "Resale value", v: arv.point },
          { k: "Renovation", v: deal.rehabWithReserve },
          { k: "Most to offer", v: deal.maxAllowableOffer },
        ].map((m) => (
          <div key={m.k} className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-[#aac4b7]">
              {m.k}
              {demo && <DemoTag />}
            </p>
            <p className="tabular mt-1.5 truncate text-lg font-semibold tracking-tight sm:text-[21px]">{money(m.v)}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-[#b9ceb9]">
        <Icon name="shield" className="h-4 w-4" />
        Includes buying and selling costs, loan interest, holding costs and a reserve for what photos cannot show.
      </p>
    </div>
  );
}

/** The asking price and the most you could offer, side by side. The most to offer is built on the resale value, so
 *  in a demo it is as made up as that and says so. */
function PriceBar({ report, demo, priceWhat }: { report: Report; demo: boolean; priceWhat: string }) {
  const { deal } = report;
  const gap = Math.round(deal.askingVsMao);
  const above = gap > 0;
  return (
    <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4" data-price-bar>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef3ee] text-ink-950">
          <Icon name="home" className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-ink-900">Asking price</p>
          <p className="text-xs text-ink-500">{priceWhat}</p>
        </div>
        <p className="tabular ml-2 text-2xl font-bold tracking-tight text-ink-900">{money(deal.purchasePrice)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
        <p className="text-sm text-ink-500">
          Most you could offer for the target profit <span className="tabular font-bold text-ink-900" data-price-mao>{money(deal.maxAllowableOffer)}</span>
          {demo && <DemoTag className="ml-2 align-middle" />}
        </p>
        <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${above ? "bg-[#fbeceb] text-pass" : "bg-[#eef4e6] text-go"}`}>
          {gap === 0 ? "The price is just that" : `The price is ${money(Math.abs(gap))} ${above ? "above" : "below"} it`}
        </span>
      </div>
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
          className={`-mb-px flex items-center whitespace-nowrap border-b-2 px-0.5 pb-3.5 text-sm font-semibold transition-colors ${active === t.key ? "border-ink-950 text-ink-950" : "border-transparent text-[#8c978f] hover:text-ink-900"}`}
        >
          {t.label}
          {typeof t.count === "number" && t.count > 0 && <span className="ml-1.5 rounded bg-[#fff0d8] px-1.5 py-0.5 text-xs text-[#aa792b]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * One analysis, as the design lays it out: the house, its photos and the verdict card, the asking price beside the
 * most to offer, then Overview, Renovation plan, Comparable sales and Risk check. Every honesty mark the report
 * carries (DEMO, UNTESTED, where each fact came from) is kept where it was.
 */
export function ResultView(p: ResultViewProps) {
  const [tab, setTab] = useState<TabKey>("overview");
  const tabsId = useId();
  const panel = (key: TabKey) => ({ id: `${tabsId}-${key}-panel`, role: "tabpanel", "aria-labelledby": `${tabsId}-${key}`, tabIndex: 0, hidden: tab !== key, "data-panel": key });
  const { report, demo, untested } = p;
  const Title = p.titleAs ?? "h2";
  const subject = report.subject;
  const subtitle = p.subtitle ?? houseLine(subject, p.sources, demo);
  // Where the listing and the public record disagree, the result says so before anything else (as the Overview and
  // the landing page promise); the flag stays in Risk check too.
  const differs = report.riskFlags.filter((f) => f.code === "RECORD_DIFFERS");
  // Quick numbers with a renovation figure typed: the engine flags a condition-priced renovation only when no figure
  // was given (lib/engine/evaluate.ts, REHAB_FROM_CONDITION), so a saved deal knows it too, without the figure itself.
  const rehabGiven = typeof p.rehabTyped === "number" || !report.riskFlags.some((f) => f.code === "REHAB_FROM_CONDITION");
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "plan", label: "Renovation plan" },
    { key: "comps", label: "Comparable sales" },
    { key: "risk", label: "Risk check", count: report.riskFlags.length },
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
        {p.actions && <div className="flex flex-wrap items-center gap-2.5">{p.actions}</div>}
      </div>

      {demo ? <DemoBanner kind={p.conditionFrom === "record" ? "quick" : "analysis"} why={p.fallbackWhy} /> : untested ? <UntestedBanner /> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.05fr_1fr]">
        <PhotoPanel previews={p.previews} photosUsed={p.photosUsed} assessment={p.assessment} conditionFrom={p.conditionFrom} />
        <VerdictCard report={report} demo={demo} untested={untested} />
      </div>

      <PriceBar report={report} demo={demo} priceWhat={p.priceWhat ?? "What the listing asks"} />
      <WithheldNote reasons={report.deal.withheld} />
      {differs.map((f, i) => (
        <div key={i} className="flex gap-3 rounded-[14px] border border-[#f0dcb4] bg-[#fff8ea] p-4 text-sm leading-relaxed text-ink-900" data-record-differs>
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-tight" />
          <p>{f.message}</p>
        </div>
      ))}

      <Tabs id={tabsId} tabs={tabs} active={tab} onChange={setTab} />

      <div {...panel("overview")} className="space-y-8">
        <div className="flex gap-4 rounded-[14px] border border-[#dfe8d6] bg-[#eef4e6] p-5">
          <Icon name="sparkle" className="mt-0.5 h-6 w-6 text-[#5f7b55]" />
          <div>
            <p className="font-bold text-ink-900" data-deciding>
              {report.deal.decidingFactor}
            </p>
            {p.plan?.finishAdvice && <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{p.plan.finishAdvice}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <DealTable report={report} demo={demo} />
          <Sensitivity report={report} demo={demo} />
        </div>
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
        {p.assessment && <AssessmentView assessment={p.assessment} />}
        {p.plan ? (
          <PlanView plan={p.plan} demo={demo} untested={untested} />
        ) : (
          <div className="card p-5 text-sm leading-relaxed text-ink-700" data-plan-none>
            {rehabGiven ? (
              <>
                No photos were read for this one, so there is no room-by-room plan. The deal uses the renovation you entered
                {typeof p.rehabTyped === "number" ? `, ${money(p.rehabTyped)},` : ""} plus a reserve for what photos cannot show: {money(report.deal.rehabWithReserve)} in all. From the condition on record it would be {money(report.rehab.low)} to {money(report.rehab.high)}, likely {money(report.rehab.likely)}.
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
          <ValueStats report={report} demo={demo} untested={untested} />
        </div>
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
    </section>
  );
}
