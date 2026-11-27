import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { isDemoProvider, isUntestedProvider } from "@/lib/data/demo";
import { limitsFromEnv, usageSummary, type UsageSummary } from "@/lib/usage/limits";
import { prismaUsageStore } from "@/lib/usage/prisma-store";
import { DealCard, type DealSummary } from "@/components/app/deal-card";
import { QuickStart } from "@/components/app/quick-start";
import { DemoBanner, DemoTag, UntestedBanner } from "@/components/ui/demo";
import { Icon, type IconName } from "@/components/ui/icon";
import { moneyShort } from "@/components/ui/format";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/** What a link to the analysis carries. Links made before it had its own address (the browser button, the bookmark, the deal finder) still reach it. */
const ANALYSIS_PARAMS = ["listing", "photos", "text", "price", "from", "address", "link"];

async function monthSoFar(userId: string | null): Promise<UsageSummary | null> {
  if (!userId) return null;
  try {
    return await usageSummary(prismaUsageStore, limitsFromEnv(), userId, new Date());
  } catch (err) {
    console.error("[overview] could not read usage", err);
    return null;
  }
}

/** The latest deals (up to 200, enough for the tiles), and how many there are in all — the sidebar's number. */
async function savedDeals(userId: string | null): Promise<{ list: DealSummary[]; total: number } | null> {
  if (!userId) return { list: [], total: 0 };
  try {
    const [list, total] = await Promise.all([
      db.deal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, title: true, source: true, askingPrice: true, verdict: true, arv: true, maxOffer: true, profit: true, provider: true, createdAt: true },
      }),
      db.deal.count({ where: { userId } }),
    ]);
    return { list, total };
  } catch (err) {
    console.error("[overview] could not read deals", err);
    return null;
  }
}

function Tile({ label, icon, value, unit, note, demo }: { label: string; icon: IconName; value: string; unit?: string; note: string; demo?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-200 bg-white px-5 py-5" data-tile={label}>
      <div className="flex items-center justify-between text-[13px] text-[#78867e]">
        <span>{label}</span>
        <Icon name={icon} className="h-[18px] w-[18px] text-[#81917f]" />
      </div>
      <p className="tabular text-3xl font-bold tracking-tight text-ink-900">
        {value}
        {unit && <span className="ml-1.5 text-sm font-medium text-ink-500">{unit}</span>}
        {demo && <DemoTag className="ml-2" />}
      </p>
      <p className="text-xs leading-relaxed text-ink-500">{note}</p>
    </div>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ userId }, params] = await Promise.all([auth(), searchParams]);
  if (ANALYSIS_PARAMS.some((k) => params[k] !== undefined)) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) query.append(k, one);
    redirect(`/app/analyze?${query.toString()}`);
  }
  const [deals, usage] = await Promise.all([savedDeals(userId), monthSoFar(userId)]);
  const list = deals?.list ?? [];
  // A database that could not be read says nothing rather than "0".
  const unread = deals === null;
  const latest = list.slice(0, 3);
  const best = list.reduce<DealSummary | null>((top, d) => (top === null || d.profit > top.profit ? d : top), null);
  const checkFirst = list.filter((d) => d.verdict === "CHECK FIRST");

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-2.5">Your next move</p>
          <h1 className="page-title">Good opportunities start here.</h1>
          <p className="page-lede">A clearer view of your deals, and a plan for your next flip.</p>
        </div>
        <Link href="/app/analyze" className="btn-primary">
          <Icon name="plus" className="h-4 w-4" />
          New analysis
        </Link>
      </div>

      <QuickStart />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Tile label="Saved deals" icon="home" value={unread ? "—" : String(deals.total)} note={unread ? "Could not be read just now." : deals.total ? "Every house you saved, with its verdict." : "Save an analysis and it shows up here."} />
        <Tile
          label="Best profit at asking"
          icon="chart"
          value={best ? moneyShort(best.profit) : "—"}
          note={best ? `${best.title}${isUntestedProvider(best.provider) ? " · untested estimate" : ""}` : "Your best saved deal, once you have one."}
          demo={best ? isDemoProvider(best.provider) : false}
        />
        <Tile
          label="Analyses this month"
          icon="sparkle"
          value={usage ? String(usage.used) : "—"}
          unit={usage ? `of ${usage.limit}` : undefined}
          note="Free during beta. Quick numbers and searches do not count."
        />
        <Tile label="Check before you offer" icon="shield" value={unread ? "—" : String(checkFirst.length)} unit={unread ? undefined : checkFirst.length === 1 ? "deal" : "deals"} note="Saved deals with something to check before any offer." />
      </div>

      {deals === null && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your saved deals could not be read just now. Reload the page in a minute.</p>}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink-900">Your deals</h2>
            <p className="mt-1 text-sm text-ink-500">The numbers you need. The details behind them.</p>
          </div>
          {list.length > 0 && (
            <Link href="/app/deals" className="inline-flex items-center gap-1 text-sm font-bold text-ink-950">
              View all deals <Icon name="chevron-right" className="h-4 w-4" />
            </Link>
          )}
        </div>
        {latest.length > 0 ? (
          <div className="space-y-4">
            {/* The same banners My deals shows: a card's profit may be made up or untested, and its badge alone is small. */}
            {latest.some((d) => isUntestedProvider(d.provider)) && <UntestedBanner kind="list" />}
            {latest.some((d) => isDemoProvider(d.provider)) && <DemoBanner kind="list" />}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {latest.map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </div>
          </div>
        ) : unread ? null : (
          <div className="card grid grid-cols-1 gap-6 p-6 md:grid-cols-3" data-overview-empty>
            {[
              { n: "1", t: "Paste a listing", d: "A link from Zillow, Redfin, Realtor.com or a brokerage site, in the box above." },
              { n: "2", t: "Add its photos", d: "Drag them from the listing's gallery. Renoflip reads the condition room by room." },
              { n: "3", t: "Read the plan and the numbers", d: "What to fix, what it costs, what homes like it sold for, and the most you can offer." },
            ].map((s) => (
              <div key={s.n} className="flex gap-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lime text-sm font-bold text-ink-950">{s.n}</span>
                <div>
                  <p className="font-bold text-ink-900">{s.t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-tight text-ink-900">A little attention goes a long way.</h2>
            <Icon name="shield" className="h-5 w-5 text-ink-500" />
          </div>
          {checkFirst.length > 0 ? (
            <ul className="mt-4 divide-y divide-ink-200 border-t border-ink-200">
              {checkFirst.slice(0, 3).map((d) => (
                <li key={d.id} className="flex items-center gap-4 py-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fff3df] text-tight">
                    <Icon name="file" className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-900">Check first: {d.title}</p>
                    <p className="text-xs text-ink-500">What would clear it is listed under its verdict.</p>
                  </div>
                  <Link href={`/app/deals/${d.id}`} className="text-sm font-bold text-ink-950">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          ) : unread ? (
            <p className="mt-4 border-t border-ink-200 pt-4 text-sm text-ink-500">Your saved deals could not be read just now, so there is no telling which need a check.</p>
          ) : (
            <ul className="mt-4 divide-y divide-ink-200 border-t border-ink-200 text-sm">
              <li className="flex gap-4 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef3ee] text-ink-950">
                  <Icon name="file" className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <p className="font-bold text-ink-900">Read the sold homes behind a value</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500">A result on real sold prices lists every sale it was drawn from, with its address and date.</p>
                </div>
              </li>
              <li className="flex gap-4 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef3ee] text-ink-950">
                  <Icon name="alert" className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <p className="font-bold text-ink-900">Check what the listing does not say</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500">Where the listing and the public record disagree, the result says so right under its verdict.</p>
                </div>
              </li>
            </ul>
          )}
        </section>

        <section className="flex flex-col rounded-[14px] border border-[#dfe8d6] bg-[#eef4e6] p-6">
          <div className="flex items-start justify-between gap-4">
            <p className="eyebrow text-[#5f7b55]">Find your next one</p>
            <Icon name="map" className="h-7 w-7 text-[#79a957]" />
          </div>
          <h2 className="mt-4 text-[26px] font-bold leading-tight tracking-tight text-ink-900">
            Homes for sale.
            <br />A first look at each.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-700">Pick zip codes, a price range and the profit you want. Renoflip puts every home on a map, the promising ones first.</p>
          <Link href="/app/find" className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-bold text-ink-950">
            Open Find deals <Icon name="chevron-right" className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
