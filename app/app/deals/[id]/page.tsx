import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import type { DealPayload } from "@/lib/deals";
import { isDemoProvider, isUntestedProvider } from "@/lib/data/demo";
import { ResultView } from "@/components/report/result-view";
import { DeleteDealButton } from "@/components/app/delete-deal-button";
import { money } from "@/components/ui/format";
import { AREA_TIME_ZONE } from "@/lib/area";
import { readScenario } from "@/lib/api/scenario";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  const deal = userId ? await db.deal.findFirst({ where: { id, userId } }) : null;
  if (!deal) notFound();
  const payload = JSON.parse(deal.payload) as DealPayload;
  // The column, not the payload: the payload is whatever the browser sent when it saved.
  const demo = isDemoProvider(deal.provider);
  const untested = isUntestedProvider(deal.provider);
  const quick = !payload.assessment;
  const saved = deal.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: AREA_TIME_ZONE });

  return (
    <ResultView
      report={payload.report}
      plan={payload.plan}
      assessment={payload.assessment}
      listing={payload.listing}
      demo={demo}
      untested={untested}
      sources={payload.subjectSources}
      data={untested ? payload.data : undefined}
      conditionFrom={quick ? "record" : "photos"}
      title={deal.title}
      titleAs="h1"
      // Quick numbers has no listing: its price is the one typed.
      priceWhat={quick && deal.source === null ? "The price you entered" : undefined}
      // Quick numbers' target is the one the person typed; a full analysis uses the default.
      targetSet={quick}
      subtitle={`Asking ${money(deal.askingPrice)} · saved ${saved}${quick ? " · quick numbers, no photos" : ""}`}
      back={{ href: "/app/deals", label: "Back to my deals" }}
      actions={<DeleteDealButton id={deal.id} />}
      // Deal Studio: the person's saved scenario, if one is kept, to open on; saving replaces it (one per deal).
      save={{ kind: "saved", dealId: deal.id }}
      scenario={readScenario(payload.scenario)}
    />
  );
}
