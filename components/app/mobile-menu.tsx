"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { AppNav, pageName } from "./nav";

/** On a phone: the mark, the page you are on, and a menu that opens the rail's links over the page, on the rail's dark. */
export function MobileMenu({ dealCount, admin = false }: { dealCount?: number; admin?: boolean }) {
  const pathname = usePathname();
  // Open on the page it was opened on: a new page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean | ((was: boolean) => boolean)) => setOpenOn((typeof value === "function" ? value(open) : value) ? pathname : null);
  // Escape closes it, as any menu does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? "mobile-nav" : undefined}
        aria-label={open ? "Close the menu" : "Open the menu"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-950"
        data-mobile-menu
      >
        <Icon name={open ? "close" : "menu"} className="h-5 w-5" />
      </button>
      <Logo href="/app" size="sm" />
      <span className="truncate border-l border-ink-200 pl-3 text-sm font-semibold text-ink-700">{pageName(pathname)}</span>
      {open && (
        <div id="mobile-nav" className="on-night fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto bg-ink-950 px-4 py-5" data-mobile-nav>
          <AppNav dealCount={dealCount} admin={admin} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
