import { auth } from "@clerk/nextjs/server";
import { Analyzer } from "@/components/analyzer";
import { prefillFromParams } from "@/lib/listing/prefill";
import { limitsFromEnv, usageSummary, type UsageSummary } from "@/lib/usage/limits";
import { prismaUsageStore } from "@/lib/usage/prisma-store";

export const metadata = { title: "New analysis" };
export const dynamic = "force-dynamic";

/** Where this person's month stands. A database that cannot say is no reason to not show the page. */
async function monthSoFar(userId: string): Promise<UsageSummary | null> {
  try {
    return await usageSummary(prismaUsageStore, limitsFromEnv(), userId, new Date());
  } catch (err) {
    console.error("[app] could not read usage", err);
    return null;
  }
}

export default async function NewAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ userId }, params] = await Promise.all([auth(), searchParams]);
  const usage = userId ? await monthSoFar(userId) : null;
  const prefill = prefillFromParams(params);
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New analysis</h1>
        <p className="mt-1 text-ink-700">Paste the listing, add the photos. You get the verdict, the ARV, the ceiling, and what to remodel for the most profit.</p>
      </div>
      <Analyzer prefill={prefill} initialUsage={usage} />
    </div>
  );
}
