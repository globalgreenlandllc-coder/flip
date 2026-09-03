import { Analyzer } from "@/components/analyzer";
import { prefillFromParams } from "@/lib/listing/prefill";

export const metadata = { title: "New analysis" };

export default async function NewAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const prefill = prefillFromParams(await searchParams);
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New analysis</h1>
        <p className="mt-1 text-ink-700">Paste the listing, add the photos. You get the verdict, the ARV, the ceiling, and what to remodel for the most profit.</p>
      </div>
      <Analyzer prefill={prefill} />
    </div>
  );
}
