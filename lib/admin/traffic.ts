/**
 * The admin Traffic view, from plain visit rows (model Visit): who is on the site, what each visitor did, where they
 * came from, and the one-sentence summary. Days are the area's (lib/area.ts).
 *
 * Pure: lib/admin/traffic-server.ts reads the rows and the accounts, app/app/admin/traffic and app/api/admin/traffic
 * show what this returns.
 */
import { areaDay } from "../visits/visit";
import { dayKeys, placeName } from "./stats";
import { STAGES, type MapPin, type SourceCard, type Stage, type StageCounts } from "./traffic-shared";

/** On the site now: a page seen in the last five minutes. */
export const ON_SITE_MS = 5 * 60_000;
/** The live window: the last half hour. */
export const LIVE_WINDOW_MS = 30 * 60_000;
/** An account counts as made during a visit when it was created at most this long before the visit's first page. */
export const SIGNUP_MATCH_MS = 15 * 60_000;

export interface TrafficRow {
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
  signedIn: boolean;
  userId: string | null;
  device: string | null;
  browser: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  clickFrom: string | null;
  adClick: boolean;
}

// ——— What a visitor is doing ———

/** A visitor keeps the furthest of their pages' stages; a new account outranks everything. */
const RANK: Record<Stage, number> = { browsing: 0, "signing-in": 1, "signing-up": 2, member: 3, "signed-up": 4 };

/** What one page says the visitor was doing. */
export function pageStage(row: Pick<TrafficRow, "path" | "signedIn">): Stage {
  if (row.signedIn) return "member";
  if (row.path === "/sign-up" || row.path.startsWith("/sign-up/")) return "signing-up";
  if (row.path === "/sign-in" || row.path.startsWith("/sign-in/")) return "signing-in";
  return "browsing";
}

// ——— Where they came from ———

export interface Source {
  /**
   * A key in a-z, 0-9, "." and "-" only (what the page's filter accepts, lib/admin/traffic-server.ts parseQuery):
   * "facebook", "instagram", "google", "tiktok", "x", "bing", …, "direct", another site's host, or a tag made safe.
   */
  platform: string;
  label: string;
  /** From an ad: a paid medium tag, or a paid-only click id without a medium that says it was not paid. */
  ad: boolean;
  campaign: string | null;
}

/** The networks always shown, as a card or as "nothing yet from". */
export const ALWAYS_SHOWN = ["facebook", "instagram", "google", "tiktok", "x"] as const;

const LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  tiktok: "TikTok",
  x: "X (Twitter)",
  bing: "Bing",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  direct: "Direct",
};

const label = (platform: string) => LABELS[platform] ?? platform;

/** A platform key the filter can carry: lower case, a-z 0-9 "." "-", at most 60 characters. */
export function platformKey(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60) || "other"
  );
}

const PAID = /^(cpc|ppc|cpm|cpv|paid|paid[_ -]?social|paidsocial|paid[_ -]?search|display|ads?|sponsored|retargeting)$/;
const UNPAID = /^(social|organic|email|e-mail|newsletter|referral|post|share|bio|profile)$/;

function platformOfTag(tag: string): string {
  const t = tag.toLowerCase();
  if (/^(fb|facebook|meta|fb_ads?|facebook_ads?)$/.test(t) || t.includes("facebook")) return "facebook";
  if (/^(ig|insta|instagram)$/.test(t) || t.includes("instagram")) return "instagram";
  if (/^(google|adwords|googleads|google_ads|gads)$/.test(t)) return "google";
  if (/^(tiktok|tt|tik_tok)$/.test(t)) return "tiktok";
  if (/^(x|twitter|t\.co)$/.test(t)) return "x";
  if (/^(bing|microsoft|msads)$/.test(t)) return "bing";
  if (t === "youtube" || t === "yt") return "youtube";
  if (t === "linkedin" || t === "li") return "linkedin";
  if (t === "reddit") return "reddit";
  if (t === "pinterest") return "pinterest";
  if (t === "snapchat" || t === "snap") return "snapchat";
  return platformKey(t);
}

function platformOfHost(host: string): string {
  const h = host.toLowerCase();
  const is = (d: string) => h === d || h.endsWith(`.${d}`);
  if (is("facebook.com") || is("fb.com") || is("fb.me")) return "facebook";
  if (is("instagram.com")) return "instagram";
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return "google";
  if (is("tiktok.com")) return "tiktok";
  if (h === "t.co" || is("x.com") || is("twitter.com")) return "x";
  if (is("bing.com")) return "bing";
  if (is("youtube.com") || h === "youtu.be") return "youtube";
  if (is("linkedin.com") || h === "lnkd.in") return "linkedin";
  if (is("reddit.com")) return "reddit";
  if (/(^|\.)pinterest\.[a-z.]+$/.test(h)) return "pinterest";
  return platformKey(h);
}

/** A page opened inside an app's own browser came from that app, when nothing else says where from. */
function platformOfApp(browser: string | null): string | null {
  if (browser === "Facebook app") return "facebook";
  if (browser === "Instagram app") return "instagram";
  if (browser === "TikTok app") return "tiktok";
  return null;
}

/**
 * Where one page's visit came from: the campaign tags first, then the network whose click id the link carried, then
 * the other site, then the app whose own browser opened the page, else Direct. An ad: a paid medium tag, or a
 * paid-only click id unless the medium says it was not paid. Facebook's fbclid alone is Facebook, not an ad.
 */
export function sourceOf(row: Pick<TrafficRow, "utmSource" | "utmMedium" | "utmCampaign" | "referrer" | "clickFrom" | "adClick" | "browser">): Source {
  const platform = (row.utmSource && platformOfTag(row.utmSource)) || row.clickFrom || (row.referrer && platformOfHost(row.referrer)) || platformOfApp(row.browser) || "direct";
  const medium = row.utmMedium?.toLowerCase() ?? null;
  const ad = medium ? PAID.test(medium) || (row.adClick && !UNPAID.test(medium)) : row.adClick;
  // An unknown tag is shown as it was written; its key is the safe form.
  const shown = LABELS[platform] ?? (row.utmSource && platformOfTag(row.utmSource) === platform ? row.utmSource : platform);
  return { platform, label: shown, ad, campaign: row.utmCampaign };
}

/** A visit's source: its first page that carried tags or a click id, else its first page from another site, else its first page. */
export function journeySource(rows: TrafficRow[]): Source {
  const pick = rows.find((r) => r.utmSource || r.utmMedium || r.adClick || r.clickFrom) ?? rows.find((r) => r.referrer) ?? rows[0];
  return sourceOf(pick);
}

// ——— Visits, one per visitor ———

export interface Page {
  path: string;
  at: Date;
}

export interface Journey {
  /**
   * One id for the list and the map: "u:", the area day and the account for a signed-in person's day, else the day's
   * fingerprint. A fingerprint can be shared by two people (the same phone model on one home network), so pages seen
   * signed out are never put under anyone's name: they stay a separate, anonymous visit. Every visit is one day's.
   */
  id: string;
  own: boolean;
  userId: string | null;
  stage: Stage;
  firstAt: Date;
  lastAt: Date;
  onSiteNow: boolean;
  pages: Page[];
  device: string | null;
  browser: string | null;
  place: string;
  lat: number | null;
  lng: number | null;
  source: Source;
}

/** Which visit a page belongs to: a signed-in page to its account's day, a signed-out one to its fingerprint (one day's too). */
export const visitKey = (r: Pick<TrafficRow, "signedIn" | "userId" | "visitor" | "createdAt">) => (r.signedIn && r.userId ? `u:${areaDay(r.createdAt)}:${r.userId}` : r.visitor);

/** The account a visit id names, if any: "u:2026-11-27:user_x" → "user_x". */
export const accountOf = (id: string) => (id.startsWith("u:") ? id.split(":").slice(2).join(":") : null);

/**
 * One visit per account (pages seen signed in) or per fingerprint (pages seen signed out), newest move first.
 * `accounts` gives when each account was made: a signed-in visit whose account was made during it is "signed up".
 */
export function journeys(rows: TrafficRow[], now: Date, accounts: Map<string, Date>): Journey[] {
  const by = new Map<string, TrafficRow[]>();
  for (const r of rows) {
    const key = visitKey(r);
    const list = by.get(key);
    if (list) list.push(r);
    else by.set(key, [r]);
  }
  const out: Journey[] = [];
  for (const [id, list] of by) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstAt = list[0].createdAt;
    const lastAt = list[list.length - 1].createdAt;
    const userId = accountOf(id);
    const made = userId ? accounts.get(userId) : undefined;
    const signedUp = Boolean(made && made.getTime() >= firstAt.getTime() - SIGNUP_MATCH_MS);
    const stage = signedUp ? "signed-up" : list.map(pageStage).reduce<Stage>((best, s) => (RANK[s] > RANK[best] ? s : best), "browsing");
    const spot = [...list].reverse().find((r) => r.lat !== null && r.lng !== null) ?? list.find((r) => r.city || r.region || r.country) ?? list[0];
    const last = list[list.length - 1];
    out.push({
      id,
      own: list.some((r) => r.own),
      userId,
      stage,
      firstAt,
      lastAt,
      onSiteNow: now.getTime() - lastAt.getTime() <= ON_SITE_MS,
      pages: list.map((r) => ({ path: r.path, at: r.createdAt })),
      device: last.device,
      browser: last.browser,
      place: placeName(spot),
      lat: spot.lat,
      lng: spot.lng,
      source: journeySource(list),
    });
  }
  return out.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || a.id.localeCompare(b.id));
}

/** The visits seen in the window: every visit (account or fingerprint) with a page in it, with its earlier pages too. */
export function activeIn(rows: TrafficRow[], since: Date): TrafficRow[] {
  const active = new Set(rows.filter((r) => r.createdAt >= since).map(visitKey));
  return rows.filter((r) => active.has(visitKey(r)));
}

/** The rows without the owner's: every fingerprint the owner was signed in under, or any of the owner's accounts. */
export function withoutOwnerRows(rows: TrafficRow[], ownAccounts: Set<string>): TrafficRow[] {
  const owner = new Set(rows.filter((r) => r.own || (r.userId && ownAccounts.has(r.userId))).map((r) => r.visitor));
  return rows.filter((r) => !owner.has(r.visitor));
}

// ——— Pages by name ———

const PAGE_NAMES: Record<string, string> = {
  "/": "Home page",
  "/sign-in": "Sign-in",
  "/sign-up": "Sign-up form",
  "/app": "Overview",
  "/app/analyze": "New analysis",
  "/app/deals": "My deals",
  "/app/deals/[id]": "A saved deal",
  "/app/find": "Find deals",
  "/app/quick": "Quick numbers",
  "/app/extension": "Browser button",
  "/app/admin": "Admin",
  "/app/admin/traffic": "Admin · Traffic",
};

export function pageName(path: string): string {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  if (path.startsWith("/sign-in/")) return "Sign-in";
  if (path.startsWith("/sign-up/")) return "Sign-up form";
  return path;
}

// ——— The numbers ———

export interface Tiles {
  onSiteNow: number;
  visitorsToday: number;
  sameTimeYesterday: number;
  signedUpToday: number;
}

/** On the site now, visitors today, and yesterday's by the same time of day, from the rows (the owner's left out). */
export function tiles(rows: TrafficRow[], now: Date, signedUpToday: number): Tiles {
  const [yesterday, today] = dayKeys(now, 2);
  const nowSet = new Set<string>();
  const todaySet = new Set<string>();
  const ySet = new Set<string>();
  const sameTime = now.getTime() - 86_400_000;
  for (const r of rows) {
    const t = r.createdAt.getTime();
    if (now.getTime() - t <= ON_SITE_MS && t <= now.getTime()) nowSet.add(r.visitor);
    const day = areaDay(r.createdAt);
    if (day === today) todaySet.add(r.visitor);
    else if (day === yesterday && t <= sameTime) ySet.add(r.visitor);
  }
  return { onSiteNow: nowSet.size, visitorsToday: todaySet.size, sameTimeYesterday: ySet.size, signedUpToday };
}

export function stageCounts(list: Journey[]): StageCounts {
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as StageCounts;
  for (const j of list) out[j.stage] += 1;
  return out;
}

/**
 * One card per source that sent someone in the window, most first; `nothingYet` names the always-shown networks that
 * sent no one. `today` counts that source's visitors since midnight.
 */
export function sourceCards(windowList: Journey[], todayList: Journey[]): { cards: SourceCard[]; nothingYet: { platform: string; label: string }[] } {
  const by = new Map<string, SourceCard>();
  for (const j of windowList) {
    const p = j.source.platform;
    const card = by.get(p) ?? { platform: p, label: j.source.label, total: 0, ads: 0, organic: 0, signingUp: 0, signedUp: 0, today: 0, campaigns: [] };
    card.total += 1;
    if (j.source.ad) card.ads += 1;
    else card.organic += 1;
    if (j.stage === "signing-up") card.signingUp += 1;
    if (j.stage === "signed-up") card.signedUp += 1;
    if (j.source.campaign && !card.campaigns.includes(j.source.campaign)) card.campaigns.push(j.source.campaign);
    by.set(p, card);
  }
  for (const j of todayList) {
    const card = by.get(j.source.platform);
    if (card) card.today += 1;
  }
  const cards = [...by.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const nothingYet = ALWAYS_SHOWN.filter((p) => !by.has(p)).map((p) => ({ platform: p, label: label(p) }));
  return { cards, nothingYet };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * One sentence on how it is going: "3 on the site now, and 12 came through in the last 30 minutes; Instagram brought
 * the most (5). 40 visitors today, 10% ahead of this time yesterday. 1 signed up today."
 */
export function summary(s: { onSiteNow: number; lastHalfHour: number; top: { label: string; count: number } | null; visitorsToday: number; sameTimeYesterday: number; signedUpToday: number | null }): string {
  const parts: string[] = [];
  if (s.lastHalfHour === 0) parts.push(s.onSiteNow > 0 ? `${s.onSiteNow.toLocaleString("en-US")} on the site now.` : "Nobody on the site in the last 30 minutes.");
  else {
    const lead = s.onSiteNow > 0 ? `${s.onSiteNow.toLocaleString("en-US")} on the site now, and ` : "Nobody on the site this minute, but ";
    const top = s.top ? `; ${s.top.label} brought the most (${s.top.count.toLocaleString("en-US")})` : "";
    parts.push(`${lead}${s.lastHalfHour.toLocaleString("en-US")} came through in the last 30 minutes${top}.`);
  }
  let today = plural(s.visitorsToday, "visitor today", "visitors today");
  if (s.sameTimeYesterday > 0) {
    const pct = Math.round(((s.visitorsToday - s.sameTimeYesterday) / s.sameTimeYesterday) * 100);
    today += pct === 0 ? ", the same as this time yesterday" : `, ${Math.abs(pct)}% ${pct > 0 ? "ahead of" : "behind"} this time yesterday`;
  } else if (s.visitorsToday > 0) today += ", and none by this time yesterday";
  parts.push(`${today}.`);
  // Unknown (the sign-in service could not be read): nothing said rather than "nobody".
  if (s.signedUpToday !== null) parts.push(s.signedUpToday > 0 ? `${s.signedUpToday.toLocaleString("en-US")} signed up today.` : "Nobody has signed up today.");
  return parts.join(" ");
}

/** The source that sent the most visitors in the window, other than Direct. */
export function topSource(cards: SourceCard[]): { label: string; count: number } | null {
  const best = cards.find((c) => c.platform !== "direct");
  return best ? { label: best.label, count: best.total } : null;
}

// ——— The map ———

export const MAX_PINS = 400;

/**
 * One pin per visitor with a place, newest first, at most MAX_PINS. Visitors in the same city share its middle, so
 * each is moved a little (always the same way for the same visitor) to keep them apart.
 */
export function mapPins(list: Journey[]): { pins: MapPin[]; cut: boolean } {
  const placed = list.filter((j) => j.lat !== null && j.lng !== null);
  const pins = placed.slice(0, MAX_PINS).map((j) => {
    const [a, b] = nudgeOf(j.id);
    return { visitor: j.id, lat: (j.lat as number) + a, lng: (j.lng as number) + b, stage: j.stage, ad: j.source.ad, now: j.onSiteNow, place: j.place, source: j.source.label };
  });
  return { pins, cut: placed.length > MAX_PINS };
}

/** A small move, always the same for the same id: up to ±0.015° each way (a string hash, FNV-1a). */
function nudgeOf(id: string): [number, number] {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return [((h & 0xffff) / 0xffff - 0.5) * 0.03, ((h >>> 16) / 0xffff - 0.5) * 0.03];
}

/** "Prospects": everyone not using the app as a member. */
export const isProspect = (j: Journey) => j.stage !== "member";

// ——— The sign-ups rail ———

/** The accounts made on the rail's days (the area's days, today included). */
export function inRail<T extends { createdAt: Date }>(people: T[], now: Date, days: number): T[] {
  const set = new Set(dayKeys(now, days));
  return people.filter((p) => set.has(areaDay(p.createdAt)));
}
