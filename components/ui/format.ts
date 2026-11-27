import { AREA_TIME_ZONE } from "@/lib/area";

/** "$420,000". */
export const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** "$420.0k", "$1.25M", "-$27.9k": a card's short form of a sum. */
export function moneyShort(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  // From $999,950 up, "k" would round to "$1000.0k": say it in millions.
  if (a >= 999_950) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** "Nov 27": a saved day as a card says it — on the area's clock, so the server (UTC) and the browser draw the same
 *  day (a card saved after 4 PM Pacific said "Nov 28" on the server and "Nov 27" in the browser). */
export const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: AREA_TIME_ZONE });

/** "2026-11-27" → "Nov 27": a day already counted on the area's clock (lib/admin/stats.ts dayKeys), read at noon UTC so no clock moves it. */
export const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The host a link points at, without "www.": "zillow.com". */
export function hostName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
