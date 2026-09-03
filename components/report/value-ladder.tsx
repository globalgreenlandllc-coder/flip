/**
 * Four bars that put the remodel decision in one picture: what the house is
 * worth today, what this plan gets it to, what a full renovation would be
 * worth per the comps, and what the block has ever paid. Shared by the
 * report and the landing page.
 */
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function ValueLadder({ asIs, afterPlan, arv, ceiling }: { asIs: number; afterPlan: number; arv: number; ceiling: number | null }) {
  const rows: { label: string; value: number; bar: string; strong?: boolean; note?: string }[] = [
    { label: "As-is today", value: asIs, bar: "bg-ink-300" },
    { label: "After this plan", value: afterPlan, bar: "bg-brand-500", strong: true },
    { label: "Fully renovated, per comps", value: arv, bar: "bg-ink-400" },
  ];
  if (ceiling !== null && Number.isFinite(ceiling)) {
    rows.push({ label: "Block ceiling", value: ceiling, bar: "bg-ink-950", note: ceiling < arv ? "below the comps: the block stops paying here" : undefined });
  }
  const max = Math.max(...rows.map((r) => r.value)) * 1.02;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className={r.strong ? "font-semibold text-ink-950" : "text-ink-700"}>
              {r.label}
              {r.note && <span className="ml-1.5 text-ink-500">· {r.note}</span>}
            </span>
            <span className={`tabular-nums ${r.strong ? "font-semibold text-ink-950" : "text-ink-700"}`}>{money(r.value)}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-ink-100">
            <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${r.bar}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
