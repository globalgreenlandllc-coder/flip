"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app", label: "New analysis", icon: "M12 5v14M5 12h14", exact: true },
  { href: "/app/deals", label: "Deals", icon: "M4 6h16M4 12h16M4 18h10", exact: false },
  { href: "/app/quick", label: "Quick numbers", icon: "M4 19V5m0 14h16M8 15l4-6 4 3 4-7", exact: false },
];

export function AppNav({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  return (
    <nav className={orientation === "vertical" ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto"}>
      {ITEMS.map((i) => {
        const active = i.exact ? pathname === i.href : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-ink-950 text-white" : "text-ink-700 hover:bg-ink-100 hover:text-ink-950"}`}
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={i.icon} /></svg>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
