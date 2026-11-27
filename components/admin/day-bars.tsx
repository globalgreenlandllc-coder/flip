"use client";

import { useState } from "react";
import { dayLabel } from "@/components/ui/format";

/** A round top for the scale: 1, 2, 5, 10, 20, 50… at or above the largest value. */
export function niceTop(max: number): number {
  if (max <= 1) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

/**
 * One number a day, as columns: one series, so the title names it and there is no legend. Hover a day for its
 * number; the table under it has every day's.
 */
export function DayBars({ title, unit, days, values, note }: { title: string; unit: [string, string]; days: string[]; values: number[] | null; note?: string }) {
  const [at, setAt] = useState<number | null>(null);
  // Not read: said so, never drawn as zeros.
  if (!values) {
    return (
      <figure className="flex min-w-0 flex-col gap-3 rounded-xl border border-ink-200 bg-white p-5" data-day-bars={title}>
        <figcaption className="text-sm font-bold text-ink-900">{title}</figcaption>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-admin-unread>
          These numbers could not be read just now. Reload the page to try again.
        </p>
      </figure>
    );
  }
  const top = niceTop(Math.max(0, ...values));
  const total = values.reduce((a, b) => a + b, 0);
  const say = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? unit[0] : unit[1]}`;
  const ticks = top >= 2 && top % 2 === 0 ? [top, top / 2, 0] : [top, 0];
  return (
    <figure className="flex min-w-0 flex-col gap-3 rounded-xl border border-ink-200 bg-white p-5" data-day-bars={title}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-bold text-ink-900">{title}</span>
        <span className="tabular text-xs text-ink-500" data-day-total>
          {say(total)} in {days.length} days
        </span>
      </figcaption>
      <div className="flex gap-2">
        <div className="tabular flex h-36 flex-col justify-between py-0 text-right text-[11px] leading-none text-ink-400" aria-hidden>
          {ticks.map((t) => (
            <span key={t}>{t.toLocaleString("en-US")}</span>
          ))}
        </div>
        <div className="relative h-36 min-w-0 flex-1" onMouseLeave={() => setAt(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-ink-100" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" role="img" aria-label={`${title}: ${say(total)} in the last ${days.length} days.`}>
            {values.map((v, i) => (
              <div key={days[i]} className="flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setAt(i)} data-day={days[i]} data-value={v}>
                {v > 0 && (
                  <div
                    className="w-full max-w-6 rounded-t-[4px] transition-colors"
                    style={{ height: `${Math.max(2, (v / top) * 100)}%`, background: at === i ? "#153d35" : "#2f8a5f" }}
                  />
                )}
              </div>
            ))}
          </div>
          {at !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink-950 px-2 py-1 text-xs text-white shadow"
              style={{ left: `${((at + 0.5) / days.length) * 100}%` }}
              data-day-tip
            >
              {dayLabel(days[at])} · {say(values[at])}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between pl-8 text-[11px] text-ink-400" aria-hidden>
        <span>{dayLabel(days[0])}</span>
        <span>{dayLabel(days[days.length - 1])}</span>
      </div>
      {note && <p className="text-xs leading-relaxed text-ink-500">{note}</p>}
      <details className="text-xs text-ink-700">
        <summary className="cursor-pointer text-ink-500">Every day&apos;s number</summary>
        <div className="mt-2 max-h-56 overflow-y-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-ink-500">
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">{unit[1][0].toUpperCase() + unit[1].slice(1)}</th>
              </tr>
            </thead>
            <tbody>
              {[...days.keys()].reverse().map((i) => (
                <tr key={days[i]} className="border-t border-ink-100">
                  <td className="py-1">{dayLabel(days[i])}</td>
                  <td className="tabular py-1 text-right">{values[i].toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
