/**
 * The admin page's sums, from plain rows. Days are the area's (lib/area.ts): a visit at 5 PM Pacific counts on that
 * day, not on UTC's next one.
 *
 * Pure: the page reads the rows and draws what this returns.
 */
import { areaDay } from "../visits/visit";

/** The last `n` days on the area's clock, oldest first, ending with the day `end` falls on: "2026-11-27". */
export function dayKeys(end: Date, n: number): string[] {
  const [y, m, d] = areaDay(end).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10));
}

/** How many of the moments fall on each of the days. Moments outside them are not counted. */
export function perDay(moments: Date[], days: string[]): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const at of moments) {
    const i = index.get(areaDay(at));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}

/** The moments that fall on the days. */
export function onDays<T>(rows: T[], days: string[], at: (row: T) => Date): T[] {
  const set = new Set(days);
  return rows.filter((r) => set.has(areaDay(at(r))));
}

export interface VisitRow {
  createdAt: Date;
  visitor: string;
  own: boolean;
  path: string;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * The visits without the owner's: every fingerprint the owner was signed in under, all of its pages, so the pages
 * the owner saw before signing in that day (the landing page, the sign-in) go too.
 */
export function withoutOwner<T extends Pick<VisitRow, "visitor" | "own">>(rows: T[]): T[] {
  const owner = new Set(rows.filter((r) => r.own).map((r) => r.visitor));
  return rows.filter((r) => !owner.has(r.visitor));
}

/** Visitors on each day. A fingerprint belongs to one day (lib/visits/visit.ts), so each counts once on its day. */
export function visitorsPerDay(rows: VisitRow[], days: string[]): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const seen = days.map(() => new Set<string>());
  for (const r of rows) {
    const i = index.get(areaDay(r.createdAt));
    if (i !== undefined) seen[i].add(r.visitor);
  }
  return seen.map((s) => s.size);
}

/** Visitors over all the rows: each once a day, the days added up. */
export const visitorCount = (rows: VisitRow[]) => new Set(rows.map((r) => r.visitor)).size;

/** "Tacoma, WA, US"; "Unknown place" when Vercel gave none. */
export function placeName(r: Pick<VisitRow, "city" | "region" | "country">): string {
  return [r.city, r.region, r.country].filter(Boolean).join(", ") || "Unknown place";
}

export interface Pin {
  lat: number;
  lng: number;
  place: string;
  visitors: number;
  visits: number;
}

/** One pin for each place with a spot on the map, the busiest first. */
export function pins(rows: VisitRow[]): Pin[] {
  const by = new Map<string, { lat: number; lng: number; place: string; who: Set<string>; visits: number }>();
  for (const r of rows) {
    if (r.lat === null || r.lng === null) continue;
    const key = `${r.lat},${r.lng}`;
    const pin = by.get(key) ?? { lat: r.lat, lng: r.lng, place: placeName(r), who: new Set<string>(), visits: 0 };
    pin.who.add(r.visitor);
    pin.visits += 1;
    by.set(key, pin);
  }
  return [...by.values()]
    .map(({ who, ...p }) => ({ ...p, visitors: who.size }))
    .sort((a, b) => b.visitors - a.visitors || b.visits - a.visits || a.place.localeCompare(b.place));
}

export interface Count {
  name: string;
  count: number;
}

/** The commonest values, most first, ties in name order; `distinct` counts each visitor once per value. */
export function top(rows: VisitRow[], value: (r: VisitRow) => string, n: number, distinct = true): Count[] {
  const by = new Map<string, Set<string> | number>();
  for (const r of rows) {
    const name = value(r);
    if (distinct) {
      const s = (by.get(name) as Set<string> | undefined) ?? new Set<string>();
      s.add(r.visitor);
      by.set(name, s);
    } else by.set(name, ((by.get(name) as number | undefined) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([name, v]) => ({ name, count: typeof v === "number" ? v : v.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}
