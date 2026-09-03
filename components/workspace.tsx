"use client";

import { useState } from "react";
import type { Report } from "@/lib/engine/types";
import { Analyzer } from "./analyzer";
import { Evaluator } from "./evaluator";

const TABS = [
  { key: "analyze", label: "Analyze a listing" },
  { key: "numbers", label: "Quick numbers" },
] as const;

export function Workspace({ initial, initialWarning }: { initial: Report | null; initialWarning?: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("analyze");
  return (
    <div>
      <div className="mt-6 flex gap-2 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-black text-black" : "border-transparent text-neutral-500 hover:text-black"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "analyze"}><Analyzer /></div>
      <div hidden={tab !== "numbers"}><Evaluator initial={initial} initialWarning={initialWarning} /></div>
    </div>
  );
}
