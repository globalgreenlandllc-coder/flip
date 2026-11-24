import { DEMO_WARNING } from "@/lib/data/demo";

/**
 * How the app says "this number is not real". Until real, dated sales are
 * connected, every price it shows comes from made-up market data, and each
 * one carries this tag: on the verdict, on each headline number, on each
 * block that is built from them. See lib/data isDemoProvider.
 */
export function DemoTag({ className = "" }: { className?: string }) {
  return (
    <span title="Made-up sales data, not a real valuation" className={`inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase leading-none tracking-wider text-amber-800 ${className}`}>
      Demo
    </span>
  );
}

export function DemoBanner({ kind = "analysis" }: { kind?: "analysis" | "quick" | "list" }) {
  const [, ...rest] = DEMO_WARNING[kind].split(". ");
  return (
    <div role="note" data-demo-banner className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Demo numbers, not a real valuation</p>
      <p className="mt-1 leading-relaxed">{rest.join(". ")}</p>
    </div>
  );
}
