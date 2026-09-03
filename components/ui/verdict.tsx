import type { Verdict } from "@/lib/engine/types";

const STYLE: Record<Verdict, string> = {
  GO: "bg-go text-white",
  TIGHT: "bg-tight text-white",
  PASS: "bg-pass text-white",
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "px-4 py-2 text-2xl" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return <span className={`inline-block rounded-lg font-bold tracking-wide ${sz} ${STYLE[verdict]}`}>{verdict}</span>;
}
