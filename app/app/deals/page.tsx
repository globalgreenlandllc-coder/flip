import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { DemoBanner, UntestedBanner } from "@/components/ui/demo";
import { isDemoProvider, isUntestedProvider } from "@/lib/data/demo";
import { DealsBrowser } from "@/components/app/deals-browser";
import { Icon } from "@/components/ui/icon";

export const metadata = { title: "My deals" };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const { userId } = await auth();
  // The list needs the summary columns only; a deal's full payload is read when it is opened.
  const deals = userId
    ? await db.deal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, source: true, askingPrice: true, verdict: true, arv: true, maxOffer: true, profit: true, provider: true, createdAt: true },
      })
    : [];
  const anyDemo = deals.some((d) => isDemoProvider(d.provider));
  const anyUntested = deals.some((d) => isUntestedProvider(d.provider));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-2.5">Your investment pipeline</p>
          <h1 className="page-title">My deals</h1>
          <p className="page-lede">Every house you saved: the opportunity, the numbers, and what to check next, together.</p>
        </div>
        <Link href="/app/analyze" className="btn-primary">
          <Icon name="plus" className="h-4 w-4" />
          New analysis
        </Link>
      </div>

      {deals.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center" data-deals-empty>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lime text-ink-950">
            <Icon name="home" className="h-6 w-6" />
          </span>
          <p className="mt-4 font-bold text-ink-900">No deals yet</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-500">Run a listing through New analysis and save it. It shows up here with its verdict, its profit at asking and the most you could offer.</p>
          <Link href="/app/analyze" className="btn-primary mt-6">
            Analyze a house
          </Link>
        </div>
      ) : (
        <>
          {anyUntested && <UntestedBanner kind="list" />}
          {anyDemo && <DemoBanner kind="list" />}
          <DealsBrowser deals={deals} />
        </>
      )}
    </div>
  );
}
