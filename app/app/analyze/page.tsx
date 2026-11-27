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

/** A listing link handed over by the Overview's box (link=): put in the link field, nothing read yet. */
function startLink(params: Record<string, string | string[] | undefined>): string | undefined {
  const given = Array.isArray(params.link) ? params.link[0] : params.link;
  return given && given.length <= 2_000 && /^https?:\/\/\S+$/i.test(given) ? given : undefined;
}

export default async function NewAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ userId }, params] = await Promise.all([auth(), searchParams]);
  const usage = userId ? await monthSoFar(userId) : null;
  const prefill = prefillFromParams(params);
  return (
    <div>
      <div className="mb-7">
        <p className="eyebrow mb-2.5">A new possibility</p>
        <h1 className="page-title">New analysis</h1>
        <p className="page-lede max-w-2xl">Paste the listing and add its photos. Renoflip reads the photos, prices the work, finds what homes like it sold for, and works out what is left for you and the most you can offer.</p>
      </div>
      <Analyzer prefill={prefill} startLink={prefill ? undefined : startLink(params)} initialUsage={usage} />
    </div>
  );
}
