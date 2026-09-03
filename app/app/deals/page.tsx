import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { VerdictBadge } from "@/components/ui/verdict";
import { money } from "@/components/report/report-view";
import type { Verdict } from "@/lib/engine/types";

export const metadata = { title: "Deals" };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const { userId } = await auth();
  const deals = userId ? await db.deal.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }) : [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deals</h1>
          <p className="mt-1 text-ink-700">Every house you have run, with its verdict.</p>
        </div>
        <Link href="/app" className="btn-primary text-sm">New analysis</Link>
      </div>

      {deals.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <p className="font-medium">No deals yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-700">Run a listing through New analysis and save it. It shows up here with its verdict, ARV and max offer.</p>
          <Link href="/app" className="btn-primary mt-6 text-sm">Analyze a house</Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-100/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Property</th>
                <th className="px-4 py-2.5 font-medium">Verdict</th>
                <th className="px-4 py-2.5 text-right font-medium">Asking</th>
                <th className="px-4 py-2.5 text-right font-medium">ARV</th>
                <th className="px-4 py-2.5 text-right font-medium">Max offer</th>
                <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                <th className="px-4 py-2.5 text-right font-medium">Saved</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-t border-ink-100 hover:bg-ink-100/40">
                  <td className="px-4 py-3">
                    <Link href={`/app/deals/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
                    {d.source && <div className="max-w-xs truncate text-xs text-ink-500">{d.source}</div>}
                  </td>
                  <td className="px-4 py-3"><VerdictBadge verdict={d.verdict as Verdict} size="sm" /></td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(d.askingPrice)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(d.arv)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(d.maxOffer)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${d.profit < 0 ? "text-pass" : ""}`}>{money(d.profit)}</td>
                  <td className="px-4 py-3 text-right text-ink-500 whitespace-nowrap">{d.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
