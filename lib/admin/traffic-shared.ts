/**
 * The parts of the Traffic view the browser needs too: the stages, the spans, the sign-up chime's rule. No server
 * code here (lib/admin/traffic.ts has the rest and re-exports these).
 */

export type Stage = "browsing" | "signing-in" | "signing-up" | "signed-up" | "member";

/** In the order the strip and the legend show them. */
export const STAGES: Stage[] = ["browsing", "signing-in", "signing-up", "signed-up", "member"];

export const STAGE_LABEL: Record<Stage, string> = {
  browsing: "Looking around",
  "signing-in": "Signing in",
  "signing-up": "Signing up",
  "signed-up": "Signed up",
  member: "Member in the app",
};

/** The pins' and dots' colours; the legend names each in words. */
export const STAGE_COLOR: Record<Stage, string> = {
  browsing: "#e0522a",
  "signing-in": "#3f86c8",
  "signing-up": "#d98e1f",
  "signed-up": "#2f8a5f",
  member: "#101820",
};

/** The ring of a visitor who came from an ad. */
export const AD_RING = "#7c3aed";

export interface Span {
  key: string;
  label: string;
  ms: number;
}

export const SPANS: Span[] = [
  { key: "5m", label: "Now · 5 min", ms: 5 * 60_000 },
  { key: "30m", label: "30 min", ms: 30 * 60_000 },
  { key: "1h", label: "1 h", ms: 3_600_000 },
  { key: "4h", label: "4 h", ms: 4 * 3_600_000 },
  { key: "6h", label: "6 h", ms: 6 * 3_600_000 },
  { key: "12h", label: "12 h", ms: 12 * 3_600_000 },
  { key: "1d", label: "1 day", ms: 86_400_000 },
  { key: "3d", label: "3 days", ms: 3 * 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "month", label: "Month", ms: 30 * 86_400_000 },
];

export const DEFAULT_SPAN = "1d";

export function spanOf(key: unknown): Span {
  return SPANS.find((s) => s.key === key) ?? SPANS.find((s) => s.key === DEFAULT_SPAN)!;
}

export const RAIL_SPANS = [
  { key: "today", label: "Today", days: 1 },
  { key: "2d", label: "2 days", days: 2 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
] as const;

export type RailKey = (typeof RAIL_SPANS)[number]["key"];

export function railOf(key: unknown): (typeof RAIL_SPANS)[number] {
  return RAIL_SPANS.find((r) => r.key === key) ?? RAIL_SPANS[0];
}

/** The sign-ups to chime for: the ones not seen on the last poll. The first poll only records (`before` null). */
export function newSignups(before: Set<string> | null, now: string[]): string[] {
  if (!before) return [];
  return now.filter((id) => !before.has(id));
}

/**
 * One poll's step for the chime: what to chime for and what to remember. `now` null means the sign-ups could not be
 * read this time: nothing chimes and the memory stays as it was (forgetting it would chime for old sign-ups later).
 */
export function signupStep(before: Set<string> | null, now: string[] | null): { chime: string[]; seen: Set<string> | null } {
  if (now === null) return { chime: [], seen: before };
  return { chime: newSignups(before, now), seen: new Set(now) };
}

export type StageCounts = Record<Stage, number>;

export interface SourceCard {
  platform: string;
  label: string;
  total: number;
  ads: number;
  organic: number;
  signingUp: number;
  signedUp: number;
  today: number;
  campaigns: string[];
}

export interface MapPin {
  visitor: string;
  lat: number;
  lng: number;
  stage: Stage;
  ad: boolean;
  now: boolean;
  place: string;
  source: string;
}
