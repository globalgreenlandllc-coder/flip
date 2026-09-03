import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import type { DealPayload } from "@/lib/deals";
import { VerdictBadge } from "@/components/ui/verdict";
import { ReportView, money } from "@/components/report/report-view";
import { PlanView } from "@/components/report/plan-view";
import { AssessmentView, ListingCard } from "@/components/report/assessment-view";
import { DeleteDealButton } from "@/components/app/delete-deal-button";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  const deal = userId ? await db.deal.findFirst({ where: { id, userId } }) : null;
  if (!deal) notFound();
  const payload = JSON.parse(deal.payload) as DealPayload;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/app/deals" className="text-sm text-ink-500 hover:text-ink-950">← Deals</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{deal.title}</h1>
            <p className="mt-1 text-sm text-ink-500">
              Asking {money(deal.askingPrice)} · saved {deal.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <DeleteDealButton id={deal.id} />
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-4 p-5">
        <VerdictBadge verdict={payload.report.deal.verdict} size="lg" />
        <p className="flex-1 basis-80 text-lg leading-snug">{payload.report.deal.decidingFactor}</p>
      </div>

      {payload.listing && <ListingCard listing={payload.listing} />}
      {payload.assessment && <AssessmentView assessment={payload.assessment} />}
      {payload.plan && <PlanView plan={payload.plan} />}
      <ReportView report={payload.report} hideVerdict />
    </div>
  );
}
