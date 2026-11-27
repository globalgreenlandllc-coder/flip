"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { QuickStart } from "./quick-start";

/**
 * The Overview's "Start your next deal" card (the design's): paste a listing link (QuickStart, unchanged in what it
 * does), or browse homes for sale by ZIP code, which is Find deals.
 */
export function StartDeal() {
  const [tab, setTab] = useState<"link" | "zip">("link");
  return (
    <section className="overflow-hidden rounded-[14px] border border-ink-200 bg-white" data-start-deal>
      <div className="px-5 pb-5 pt-6 sm:px-7">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#b9411d]">Start your next deal</p>
        <h2 className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.04em] text-ink-900 sm:text-[28px]">
          Have a home in mind?
          <br />
          <span className="text-ink-500">Or find your starting point.</span>
        </h2>
      </div>
      <div className="flex gap-1 border-y border-ink-200 bg-[#fafaf7] px-3 sm:px-5" role="group" aria-label="How to start">
        {(
          [
            ["link", "Paste a link", "link"],
            ["zip", "Browse by ZIP", "pin"],
          ] as const
        ).map(([k, label, icon]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3.5 text-sm ${tab === k ? "border-orange font-semibold text-[#b9411d]" : "border-transparent text-ink-500 hover:text-ink-900"}`}
            data-start-tab={k}
          >
            <Icon name={icon} className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="px-5 py-6 sm:px-7">
        {tab === "link" ? (
          <QuickStart />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-start-zip>
            <p className="max-w-xl text-sm leading-relaxed text-ink-700">Pick ZIP codes, a price range to buy in and the profit you want. RenoFlip puts the homes for sale on a map, the promising ones first, each with a first look at its numbers.</p>
            <Link href="/app/find" className="btn-accent shrink-0">
              Open Find deals
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
