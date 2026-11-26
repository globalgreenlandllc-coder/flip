import { DEMO_WARNING, UNTESTED_WARNING } from "@/lib/data/demo";

/**
 * How the app says "this number is not real". A result built on made-up
 * market data carries this tag on each price: on the verdict, on each
 * headline number, on each block that is built from them. See lib/data
 * isDemoProvider.
 */
export function DemoTag({ className = "" }: { className?: string }) {
  return (
    <span title="Made-up sales data, not a real valuation" className={`inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase leading-none tracking-wider text-amber-800 ${className}`}>
      Demo
    </span>
  );
}

/**
 * The notice over a demo result. `why`: when real sold prices are connected
 * and this result could not have them, the sentence that says so comes
 * first (lib/data/house-data.ts Fallback).
 */
export function DemoBanner({ kind = "analysis", why }: { kind?: "analysis" | "quick" | "list"; why?: string }) {
  const [, ...rest] = DEMO_WARNING[kind].split(". ");
  return (
    <div role="note" data-demo-banner className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Demo numbers, not a real valuation</p>
      {why && (
        <p className="mt-1 font-medium leading-relaxed" data-demo-why>
          {why}
        </p>
      )}
      <p className="mt-1 leading-relaxed">{rest.join(". ")}</p>
    </div>
  );
}

/**
 * The notice over a result built on real sold prices. Those are real; the
 * method that turns them into a resale value has not been tested against
 * real flips in any area yet, and the result says that before anything else.
 */
export function UntestedBanner({ kind = "analysis" }: { kind?: "analysis" | "list" }) {
  const [, ...rest] = UNTESTED_WARNING[kind].split(". ");
  return (
    <div role="note" data-untested-banner className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950">
      <p className="font-semibold">{kind === "list" ? "Untested estimates" : "Real sold prices, untested estimate"}</p>
      <p className="mt-1 leading-relaxed">{rest.join(". ")}</p>
    </div>
  );
}
