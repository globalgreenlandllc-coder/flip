"use client";

import { useState } from "react";
import Image, { type StaticImageData } from "next/image";
import exterior from "@/public/brand/concept-exterior.jpg";
import kitchen from "@/public/brand/concept-kitchen.jpg";

/**
 * The design's before-and-after, with its two illustrative concept pictures (public/brand/CREDITS.md): each file holds
 * the "before" on its left half and the "after" on its right half (each half has the box's own shape, so the cover
 * fit, pinned left or right, shows exactly that half). They are made-up AI pictures, not a real house and not anything
 * RenoFlip drew, and the page says so under them. The view shown loads with the page; the other loads when chosen.
 */
const VIEWS = {
  exterior: {
    tab: "Exterior",
    src: exterior as StaticImageData,
    aspect: "4 / 3",
    action: "Targeted curb appeal",
    heading: "A better first impression.",
    detail: "Refresh the entry, the finish and the planting. Keep the required repairs visible in the budget.",
    cost: "$6,500",
  },
  kitchen: {
    tab: "Kitchen",
    src: kitchen as StaticImageData,
    aspect: "3 / 2",
    action: "Market-ready refresh",
    heading: "Keep the layout. Improve the finish.",
    detail: "Cabinets, counters, lighting and appliances, without assuming the layout changes.",
    cost: "$18,000",
  },
} as const;

export function BeforeAfter() {
  const [view, setView] = useState<keyof typeof VIEWS>("exterior");
  const [split, setSplit] = useState(50);
  const v = VIEWS[view];
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.45fr_1fr] lg:gap-12" data-before-after>
      <div className="min-w-0">
        <div className="mb-4 flex gap-2" role="group" aria-label="Which concept">
          {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              onClick={() => setView(k)}
              className={`rounded-[7px] border px-4 py-2 text-sm font-semibold ${view === k ? "border-orange bg-white text-[#141820]" : "border-[#dfe3e8] bg-white/60 text-[#596170] hover:text-[#141820]"}`}
            >
              {VIEWS[k].tab}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-full overflow-hidden rounded-[10px] bg-[#e9ecf0]" style={{ aspectRatio: v.aspect }}>
          {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => (
            <div key={k} className={k === view ? "absolute inset-0" : "hidden"}>
              {/* The picture is twice as wide as the box: sized for that, so each half stays sharp. */}
              <Image src={VIEWS[k].src} alt={`Illustrative concept: ${VIEWS[k].tab.toLowerCase()} before`} fill loading={k === view ? "eager" : "lazy"} placeholder="blur" sizes="(min-width: 1024px) 1500px, 200vw" className="object-cover object-left" />
              <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                <Image src={VIEWS[k].src} alt={`Illustrative concept: ${VIEWS[k].tab.toLowerCase()} after`} fill loading={k === view ? "eager" : "lazy"} placeholder="blur" sizes="(min-width: 1024px) 1500px, 200vw" className="object-cover object-right" />
              </div>
            </div>
          ))}
          <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white/90" style={{ left: `${split}%` }} aria-hidden />
          <span className="absolute left-3 top-3 rounded-[3px] bg-black/60 px-2 py-1 text-[11px] font-semibold text-white" data-concept-label>
            Before · concept
          </span>
          <span className="absolute right-3 top-3 rounded-[3px] bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">After · concept</span>
        </div>
        <label className="mt-4 flex items-center gap-4 text-sm text-[#596170]">
          <span className="shrink-0">Compare before and after</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="range min-w-0 flex-1" aria-label="Compare before and after" />
        </label>
        <p className="mt-3 text-xs leading-relaxed text-[#626a77]" data-concept-note>
          Illustrative concept pictures, AI-generated for this page: not photos of a real house or of a finished project, and not made by RenoFlip. RenoFlip does not draw renovations yet; a before-and-after of your own photos is coming.
        </p>
      </div>
      <div className="flex min-w-0 flex-col justify-center">
        <p className="text-sm font-semibold text-[#b9411d]">{v.action}</p>
        <h3 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.045em] text-[#141820]">{v.heading}</h3>
        <p className="mt-3 leading-relaxed text-[#596170]">{v.detail}</p>
        <div className="mt-6 border-t border-[#dfe3e8] pt-5">
          <p className="text-sm text-[#596170]">Sample allowance</p>
          <p className="tabular mt-1 text-3xl font-semibold tracking-tight text-[#141820]">{v.cost}</p>
          <p className="mt-1 text-xs text-[#626a77]">An illustrative figure for the work in the pictures, before the reserve. In a report, the plan is priced from your listing&apos;s own photos.</p>
        </div>
        <a href="#approach" className="btn-secondary mt-6 self-start">
          Compare sample strategies
        </a>
      </div>
    </div>
  );
}
