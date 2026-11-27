"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Tells the server a page was seen (app/api/visit): its path and, for the first page of a visit, the page the visitor
 * came from. Nothing is stored in the browser. It never holds the page up, and a page it cannot report is simply not counted.
 */
export function VisitBeacon() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (!pathname) return;
    const body = JSON.stringify({ path: pathname, ref: first.current ? document.referrer : "" });
    first.current = false;
    try {
      if (!navigator.sendBeacon?.("/api/visit", body)) void fetch("/api/visit", { method: "POST", body, keepalive: true }).catch(() => {});
    } catch {
      // Not counted.
    }
  }, [pathname]);
  return null;
}
