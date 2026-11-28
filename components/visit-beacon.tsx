"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { clickOf } from "@/lib/visits/click-ids";

/**
 * The first page's campaign tags (utm_*), which network's click id the link carried and whether it was one only paid
 * ads get (lib/visits/click-ids.ts). Only these are sent: the rest of the query string, and the click id itself, never
 * leave the page.
 */
function campaign(): { utm: Record<string, string>; click: string | null; ad: boolean } {
  const q = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const k of ["source", "medium", "campaign", "content"]) {
    const v = q.get(`utm_${k}`);
    if (v) utm[k] = v.slice(0, 200);
  }
  return { utm, ...clickOf((k) => q.has(k)) };
}

/**
 * Tells the server a page was seen (app/api/visit): its path and, for the first page of a visit, the page the visitor
 * came from and the link's campaign tags. Nothing is stored in the browser. It never holds the page up, and a page it
 * cannot report is simply not counted.
 */
export function VisitBeacon() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (!pathname) return;
    const body = JSON.stringify(first.current ? { path: pathname, ref: document.referrer, ...campaign() } : { path: pathname, ref: "" });
    first.current = false;
    try {
      if (!navigator.sendBeacon?.("/api/visit", body)) void fetch("/api/visit", { method: "POST", body, keepalive: true }).catch(() => {});
    } catch {
      // Not counted.
    }
  }, [pathname]);
  return null;
}
