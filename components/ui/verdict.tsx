import type { Verdict } from "@/lib/engine/types";

const STYLE: Record<Verdict, string> = {
  GO: "bg-go text-white",
  TIGHT: "bg-tight text-white",
  PASS: "bg-pass text-white",
};

const SIZE = {
  lg: { verdict: "px-4 py-2 text-2xl", demo: "px-2.5 text-xs" },
  md: { verdict: "px-3 py-1 text-sm", demo: "px-2 text-[10px]" },
  sm: { verdict: "px-2 py-0.5 text-xs", demo: "px-1.5 text-[9px]" },
};

/**
 * The verdict. With `demo`, the word DEMO is part of the badge itself: a
 * verdict worked out from made-up sales must never be readable as a real one,
 * however it is cropped, copied or screenshotted.
 */
export function VerdictBadge({ verdict, size = "md", demo = false }: { verdict: Verdict; size?: "sm" | "md" | "lg"; demo?: boolean }) {
  const sz = SIZE[size];
  if (!demo) return <span className={`inline-block rounded-lg font-bold tracking-wide ${sz.verdict} ${STYLE[verdict]}`}>{verdict}</span>;
  return (
    <span data-demo-verdict title="Made-up sales data, not a real valuation" className="inline-flex items-stretch overflow-hidden rounded-lg font-bold tracking-wide">
      <span className={`flex items-center bg-ink-950 uppercase tracking-wider text-amber-300 ${sz.demo}`}>Demo</span>
      <span className={`${sz.verdict} ${STYLE[verdict]}`}>{verdict}</span>
    </span>
  );
}
