import Link from "next/link";
import type { Verdict } from "@/lib/engine/types";
import { isDemoProvider, isUntestedProvider } from "@/lib/data/demo";
import { VerdictBadge } from "@/components/ui/verdict";
import { Icon } from "@/components/ui/icon";
import { hostName, moneyShort, shortDay } from "@/components/ui/format";

/** A saved deal as a list shows it: the summary columns only, never its full payload. */
export interface DealSummary {
  id: string;
  title: string;
  source: string | null;
  askingPrice: number;
  verdict: string;
  arv: number;
  maxOffer: number;
  profit: number;
  provider: string | null;
  createdAt: Date;
}

/**
 * A saved deal as a card. flip keeps no listing photos (they are the listing's own), so the top of the card is a
 * quiet panel with the verdict, marked DEMO or UNTESTED as it was worked out.
 */
export function DealCard({ deal: d }: { deal: DealSummary }) {
  const demo = isDemoProvider(d.provider);
  const untested = isUntestedProvider(d.provider);
  // No link behind it: Quick numbers, or photos run with no listing — the card cannot tell them apart without the saved
  // result, so it says only what is true of both. A listing with no link (a pasted page) says so.
  const where = d.source === null ? "No listing link" : (hostName(d.source) ?? (d.source ? "pasted page" : "a listing without a link"));
  return (
    <Link
      href={`/app/deals/${d.id}`}
      data-deal-card={d.verdict}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-ink-200 bg-white transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_#153d3512] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-[#e9f1e7] via-[#dfeadc] to-[#cfdfcb]">
        <Icon name="home" className="absolute -bottom-3 -right-2 h-28 w-28 text-white/60 transition-transform duration-300 group-hover:scale-105" strokeWidth={1.2} />
        <div className="absolute left-3 top-3">
          <VerdictBadge verdict={d.verdict as Verdict} size="sm" demo={demo} untested={untested} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 text-[17px] font-bold leading-snug tracking-tight text-ink-900">{d.title}</h3>
        <p className="mt-1 truncate text-sm text-ink-500">{where}</p>
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-ink-200 pt-4">
          <div>
            <p className="text-xs text-ink-500">Asking price</p>
            <p className="tabular mt-1 text-xl font-bold tracking-tight text-ink-900">{moneyShort(d.askingPrice)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Profit at asking</p>
            <p className={`tabular mt-1 text-xl font-bold tracking-tight ${d.profit < 0 ? "text-pass" : "text-go"}`}>{moneyShort(d.profit)}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-ink-200 px-5 py-3 text-xs">
        <span className="text-ink-500">Saved {shortDay(d.createdAt)}</span>
        <span className="inline-flex items-center gap-1 font-semibold text-ink-950">
          Open analysis <Icon name="chevron-right" className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
