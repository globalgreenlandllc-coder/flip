"use client";

import { useMemo, useState } from "react";
import { DealCard, type DealSummary } from "./deal-card";
import { Icon } from "@/components/ui/icon";

const FILTERS = [
  { key: "all", label: "All deals" },
  { key: "GO", label: "Go" },
  { key: "TIGHT", label: "Tight" },
  { key: "PASS", label: "Pass" },
  { key: "CHECK FIRST", label: "Check first" },
] as const;

/** Every saved deal as a card, with a search over their names and links, and the verdicts to pick from. */
export function DealsBrowser({ deals }: { deals: DealSummary[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return deals.filter((d) => (filter === "all" || d.verdict === filter) && words.every((w) => `${d.title} ${d.source ?? ""}`.toLowerCase().includes(w)));
  }, [deals, query, filter]);
  const count = (key: string) => (key === "all" ? deals.length : deals.filter((d) => d.verdict === key).length);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex w-full items-center gap-2.5 rounded-[10px] border border-ink-200 bg-white px-3.5 sm:w-80">
          <Icon name="search" className="h-[18px] w-[18px] text-ink-400" />
          <span className="sr-only">Search your deals</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your deals" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-[#98a0a3]" data-deals-search />
        </label>
        <div className="flex flex-wrap gap-1 rounded-[10px] bg-white/60 p-1" role="group" aria-label="Show deals by verdict">
          {FILTERS.filter((f) => f.key === "all" || count(f.key) > 0).map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              data-deals-filter={f.key}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${filter === f.key ? "bg-[#eef0ea] text-ink-950" : "text-[#67717a] hover:text-ink-950"}`}
            >
              {f.label}
              <span className="ml-1.5 text-xs font-medium text-ink-400">{count(f.key)}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((d) => (
            <DealCard key={d.id} deal={d} />
          ))}
        </div>
      ) : (
        <p className="card px-6 py-10 text-center text-sm text-ink-500">No saved deal matches. Clear the search or pick All deals.</p>
      )}
    </div>
  );
}
