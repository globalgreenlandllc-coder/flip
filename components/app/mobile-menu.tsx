"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { AppNav, pageName } from "./nav";

/** On a phone: the wordmark, the page you are on, and a menu that opens the sidebar's lists over the page. */
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
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-950"
        data-mobile-menu
      >
        <Icon name={open ? "close" : "menu"} className="h-5 w-5" />
      </button>
      <Logo href="/app" size="sm" />
      <span className="truncate text-sm font-semibold text-ink-700">{pageName(pathname)}</span>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-ink-200 bg-white px-4 py-5" data-mobile-nav>
          <AppNav dealCount={dealCount} admin={admin} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
