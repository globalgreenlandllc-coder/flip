"use client";

import { useState } from "react";
import Link from "next/link";
import { evaluateDeal } from "@/lib/engine/deal";
import { DEFAULT_DEAL_TERMS } from "@/lib/engine/defaults";
import { VerdictBadge } from "@/components/ui/verdict";
import { SAMPLE_DEAL } from "./samples";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

const MIN = 480_000;
const MAX = 650_000;

/**
 * The landing page's sample deal explorer: one slider, the purchase price, fed to the same evaluateDeal() a report
 * runs, with the default terms. Only the sample's resale value and work are hand-picked; every other number is
 * the engine's.
 */
export function DealExplorer({ cta }: { cta: { href: string; label: string } }) {
  const [price, setPrice] = useState(SAMPLE_DEAL.askingPrice);
  const deal = evaluateDeal(SAMPLE_DEAL.arv, { ...DEFAULT_DEAL_TERMS, askingPrice: price, rehab: SAMPLE_DEAL.rehab });
  const other = deal.totalCost - deal.purchasePrice - deal.rehabWithReserve;
  return (
    <div className="rounded-[18px] bg-ink-950 p-6 text-white shadow-[0_30px_70px_-30px_rgb(21_61_53_/_0.6)] sm:p-8" data-deal-explorer>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-[#b2cbc0]">Sample deal explorer</p>
        <span className="rounded-md border border-white/20 px-2 py-0.5 text-xs text-[#c0d5c8]">Live calculation</span>
      </div>
      <div className="mt-5 border-t border-white/15 pt-5">
        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-[#c0d5c8]">Your purchase price</span>
            <span className="tabular text-xl font-semibold">{money(price)}</span>
          </span>
          <input type="range" min={MIN} max={MAX} step={5_000} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="mt-3 w-full cursor-pointer accent-lime" aria-label="Purchase price" />
          <span className="mt-1 flex justify-between text-xs text-[#8fae9f]">
            <span>{money(MIN)}</span>
            <span>{money(MAX)}</span>
          </span>
        </label>
      </div>
      <dl className="mt-5 space-y-2.5 text-sm">
        {[
          ["Renovation, with a reserve", deal.rehabWithReserve],
          ["Other project costs", other],
          ["Resale value", deal.arv],
        ].map(([k, v]) => (
          <div key={k as string} className="flex justify-between gap-3">
            <dt className="text-[#c0d5c8]">{k}</dt>
            <dd className="tabular">{money(v as number)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 border-t border-white/15 pt-5 text-center">
        <p className="text-sm text-[#c0d5c8]">Profit at this price, before tax</p>
        <p className={`tabular mt-1 text-5xl font-bold tracking-[-0.04em] ${deal.profit < 0 ? "text-[#f4c7c2]" : "text-lime"}`} data-explorer-profit>
          {money(deal.profit)}
        </p>
        <p className="mt-2 flex items-center justify-center gap-2 text-xs text-[#aac4b7]">
          <VerdictBadge verdict={deal.verdict} size="sm" /> for this sample, at this price. Every cost above is included.
        </p>
      </div>
      <Link href={cta.href} className="btn-lime mt-6 w-full">
        {cta.label}
      </Link>
      <p className="mt-3 text-center text-[11px] text-[#8fae9f]">A sample house: 1,840 sqft, comps at {money(SAMPLE_DEAL.arv)}, work at {money(SAMPLE_DEAL.rehab)}. Not a real listing.</p>
    </div>
  );
}
