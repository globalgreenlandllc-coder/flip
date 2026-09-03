import { Analyzer } from "@/components/analyzer";

export const metadata = { title: "New analysis" };

export default function NewAnalysisPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New analysis</h1>
        <p className="mt-1 text-ink-700">Paste the listing, add the photos. You get the verdict, the ARV, the ceiling, and what to remodel for the most profit.</p>
      </div>
      <Analyzer />
    </div>
  );
}
