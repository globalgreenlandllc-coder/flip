import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { kind } from "@/lib/data/asker";
import { adminEmails, isAdmin } from "@/lib/admin/access";
import { adminIds } from "@/lib/visits/keep";
import { LIVE_WINDOW_MS, activeIn, inRail, isProspect, journeySource, journeys, mapPins, pageName, sourceCards, stageCounts, summary, tiles, topSource, withoutOwnerRows, type Journey, type TrafficRow } from "./traffic";
import { STAGE_LABEL, railOf, spanOf, type MapPin, type RailKey, type SourceCard, type Stage, type StageCounts } from "./traffic-shared";
import { areaDay } from "@/lib/visits/visit";

/**
 * The Traffic view's data, read from the database and the sign-in service and shaped by lib/admin/traffic.ts. Only an
 * admin's page and the admin-only route call it. Every part that cannot be read says so instead of showing zeros.
 */

const HOUR = 3_600_000;
/** The most rows read for one view: the map's month at the daily limit would be far more than a live view needs. */
const ROWS_READ = 100_000;
/** The newest accounts read for the sign-ups and the names. */
const PEOPLE_READ = 500;
/** The list's longest length. */
const LIST_MAX = 60;

export interface TrafficQuery {
  span: string;
  audience: "everyone" | "prospects";
  source: string | null;
  mine: boolean;
  rail: RailKey;
}

export function parseQuery(get: (name: string) => string | null): TrafficQuery {
  const source = get("source");
  return {
    span: spanOf(get("span")).key,
    audience: get("audience") === "prospects" ? "prospects" : "everyone",
    source: source && /^[a-z0-9.-]{1,100}$/.test(source) ? source : null,
    mine: get("mine") === "1",
    rail: railOf(get("rail")).key,
  };
}

export interface ListRow {
  visitor: string;
  you: boolean;
  name: string | null;
  email: string | null;
  stage: Stage;
  stageLabel: string;
  pages: { name: string; at: string }[];
  pageCount: number;
  onSiteNow: boolean;
  firstAt: string;
  lastAt: string;
  device: string | null;
  browser: string | null;
  place: string;
  source: { label: string; ad: boolean; campaign: string | null };
}

export interface RailPerson {
  id: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  /**
   * Where the account's first signed-in visit probably came from: the source of that device's first page that day.
   * Only a name, said as likely: the fingerprint can be another person's on the same network, so no page of it is shown.
   */
  probablyFrom: string | null;
}

export interface TrafficData {
  at: string;
  query: TrafficQuery;
  stale: boolean;
  unread: { visits: boolean; people: boolean; since: boolean };
  tiles: { onSiteNow: number; visitorsToday: number; sameTimeYesterday: number; signedUpToday: number | null; visitorsSince: number | null; since: string | null } | null;
  sentence: string | null;
  lastHalfHour: number;
  stages: StageCounts;
  cards: SourceCard[];
  nothingYet: { platform: string; label: string }[];
  map: { pins: MapPin[]; cut: boolean; count: number };
  /** The read stopped at ROWS_READ pages: the oldest of this time are left out of the map and the list. */
  rowsCut: boolean;
  list: ListRow[];
  rail: { people: RailPerson[] } | null;
  /** Today's sign-ups, for the chime; null when the sign-in service could not be read (the page then keeps what it had). */
  signupIds: string[] | null;
}

interface Person {
  id: string;
  name: string | null;
  email: string | null;
  createdAt: Date;
  admin: boolean;
}

type ClerkUser = { id: string; firstName: string | null; lastName: string | null; username: string | null; createdAt: number; primaryEmailAddress?: { emailAddress: string } | null; emailAddresses: { emailAddress: string; verification?: { status?: string | null } | null }[] };

function person(u: ClerkUser, admins: Set<string>): Person {
  return {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null,
    email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
    createdAt: new Date(u.createdAt),
    admin: isAdmin(u, admins),
  };
}

async function read<T>(what: string, get: () => Promise<T>): Promise<T | null> {
  try {
    return await get();
  } catch (err) {
    console.error(`[traffic] could not read ${what}`, kind(err));
    return null;
  }
}

const ROW_SELECT = {
  createdAt: true,
  visitor: true,
  own: true,
  path: true,
  referrer: true,
  country: true,
  region: true,
  city: true,
  lat: true,
  lng: true,
  signedIn: true,
  userId: true,
  device: true,
  browser: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmContent: true,
  clickFrom: true,
  adClick: true,
} as const;

/** Visitors since counting began: a count over the whole table, so asked at most every five minutes on each server. */
const SINCE_FOR_MS = 5 * 60_000;
let sinceKept: { at: number; value: { n: number; first: Date | null } } | null = null;

async function visitorsSince(now: Date): Promise<{ n: number; first: Date | null }> {
  if (sinceKept && now.getTime() - sinceKept.at < SINCE_FOR_MS) return sinceKept.value;
  const [r] = await db.$queryRaw<{ n: number; first: Date | null }[]>`
    SELECT COUNT(DISTINCT "visitor")::int AS n, MIN("createdAt") AS first FROM "Visit"
    WHERE "visitor" NOT IN (SELECT "visitor" FROM "Visit" WHERE "own")`;
  const value = r ?? { n: 0, first: null };
  sinceKept = { at: now.getTime(), value };
  return value;
}

const sourceJson = (j: { source: { label: string; ad: boolean; campaign: string | null } }) => ({ label: j.source.label, ad: j.source.ad, campaign: j.source.campaign });

/** Everything the Traffic view shows for one query, as of `now`. `viewerId` is the admin looking. */
export async function loadTraffic(q: TrafficQuery, viewerId: string, now = new Date()): Promise<TrafficData> {
  const admins = adminEmails();
  const span = spanOf(q.span);
  const rail = railOf(q.rail);
  // Two days for today and yesterday's same time, or the map's span when longer.
  const since = new Date(now.getTime() - Math.max(49 * HOUR, span.ms));

  const [rows, people, sinceCount, ownIds] = await Promise.all([
    read("the visits", () => db.visit.findMany({ where: { createdAt: { gte: since, lte: now } }, select: ROW_SELECT, orderBy: { createdAt: "desc" }, take: ROWS_READ })),
    read("the sign-ups", async () => {
      const client = await clerkClient();
      const res = await client.users.getUserList({ limit: PEOPLE_READ, orderBy: "-created_at" });
      return res.data.map((u) => person(u as unknown as ClerkUser, admins));
    }),
    read("the visitors since counting began", () => visitorsSince(now)),
    adminIds().catch(() => null),
  ]);

  const ownAccounts = new Set<string>([viewerId, ...(ownIds ?? []), ...(people ?? []).filter((p) => p.admin).map((p) => p.id)]);
  const all: TrafficRow[] = rows ?? [];
  const counted = withoutOwnerRows(all, ownAccounts);
  const accounts = new Map((people ?? []).map((p) => [p.id, p.createdAt]));

  // The live half hour: every visit with a page in it (its earlier pages that day too). Read only from the last day,
  // whatever span the map shows: the map's choice never changes the live numbers.
  const windowStart = new Date(now.getTime() - LIVE_WINDOW_MS);
  const lastDay = new Date(now.getTime() - 25 * HOUR);
  const recent = counted.filter((r) => r.createdAt >= lastDay);
  const live = journeys(activeIn(recent, windowStart), now, accounts);
  const today = areaDay(now);
  const todayList = journeys(recent.filter((r) => areaDay(r.createdAt) === today), now, accounts);
  const { cards, nothingYet } = sourceCards(live, todayList);
  const others = (people ?? []).filter((p) => !ownAccounts.has(p.id));
  const signedUpToday = people ? inRail(others, now, 1).length : null;
  const t = tiles(counted, now, signedUpToday ?? 0);

  // What the list and the map show: the owner's visits only when asked for, a pressed source card filtering both.
  const shown = q.mine ? all : counted;
  const bySource = (j: Journey) => !q.source || j.source.platform === q.source;
  const listJourneys = journeys(activeIn(shown.filter((r) => r.createdAt >= lastDay), windowStart), now, accounts).filter(bySource).slice(0, LIST_MAX);
  const spanStart = new Date(now.getTime() - span.ms);
  const mapJourneys = journeys(shown.filter((r) => r.createdAt >= spanStart), now, accounts)
    .filter(bySource)
    .filter((j) => q.audience === "everyone" || isProspect(j));
  const map = mapPins(mapJourneys);

  // Names for the signed-in rows: from the newest accounts, else asked for by id.
  const names = new Map((people ?? []).map((p) => [p.id, p]));
  const missing = [...new Set(listJourneys.map((j) => j.userId).filter((id): id is string => Boolean(id) && !names.has(id as string)))].slice(0, 100);
  if (missing.length) {
    const more = await read("the visitors' names", async () => {
      const client = await clerkClient();
      const res = await client.users.getUserList({ userId: missing, limit: 100 });
      return res.data.map((u) => person(u as unknown as ClerkUser, admins));
    });
    for (const p of more ?? []) names.set(p.id, p);
  }

  const list: ListRow[] = listJourneys.map((j) => {
    const p = j.userId ? names.get(j.userId) : undefined;
    return {
      visitor: j.id,
      you: j.own || Boolean(j.userId && ownAccounts.has(j.userId)),
      name: p?.name ?? null,
      email: p?.email ?? null,
      stage: j.stage,
      stageLabel: STAGE_LABEL[j.stage],
      pages: j.pages.map((pg) => ({ name: pageName(pg.path), at: pg.at.toISOString() })),
      pageCount: j.pages.length,
      onSiteNow: j.onSiteNow,
      firstAt: j.firstAt.toISOString(),
      lastAt: j.lastAt.toISOString(),
      device: j.device,
      browser: j.browser,
      place: j.place,
      source: sourceJson(j),
    };
  });

  // The rail: accounts made on its days, the owner's left out, each with where their first visit came from.
  let railPeople: RailPerson[] | null = null;
  if (people) {
    const made = inRail(others, now, rail.days);
    const sources = await read("where the sign-ups came from", async () => {
      const ids = made.map((p) => p.id).slice(0, 200);
      if (!ids.length) return new Map<string, string>();
      const theirs = await db.visit.findMany({ where: { userId: { in: ids }, signedIn: true }, select: { userId: true, visitor: true }, orderBy: { createdAt: "asc" } });
      const firstPrint = new Map<string, string>();
      for (const v of theirs) if (v.userId && !firstPrint.has(v.userId)) firstPrint.set(v.userId, v.visitor);
      const prints = [...new Set(firstPrint.values())];
      const pages = prints.length ? await db.visit.findMany({ where: { visitor: { in: prints } }, select: ROW_SELECT, orderBy: { createdAt: "asc" } }) : [];
      const out = new Map<string, string>();
      for (const [id, print] of firstPrint) {
        const visit = pages.filter((r) => r.visitor === print);
        if (visit.length) out.set(id, journeySource(visit).label);
      }
      return out;
    });
    railPeople = made.map((p) => ({ id: p.id, name: p.name, email: p.email, createdAt: p.createdAt.toISOString(), probablyFrom: sources?.get(p.id) ?? null }));
  }

  // Visitors (devices) in the half hour, as "on the site now" counts them; a person who signed up in it is one visitor
  // here though their visit shows twice below (signed out, then under their name).
  const lastHalfHour = new Set(recent.filter((r) => r.createdAt >= windowStart).map((r) => r.visitor)).size;
  return {
    at: now.toISOString(),
    query: q,
    stale: false,
    unread: { visits: rows === null, people: people === null, since: sinceCount === null },
    tiles: rows
      ? { onSiteNow: t.onSiteNow, visitorsToday: t.visitorsToday, sameTimeYesterday: t.sameTimeYesterday, signedUpToday, visitorsSince: sinceCount?.n ?? null, since: sinceCount?.first ? new Date(sinceCount.first).toISOString() : null }
      : null,
    sentence: rows ? summary({ onSiteNow: t.onSiteNow, lastHalfHour, top: topSource(cards), visitorsToday: t.visitorsToday, sameTimeYesterday: t.sameTimeYesterday, signedUpToday }) : null,
    lastHalfHour,
    stages: stageCounts(live),
    cards,
    nothingYet,
    map: { pins: map.pins, cut: map.cut, count: mapJourneys.length },
    rowsCut: all.length === ROWS_READ,
    list,
    rail: railPeople ? { people: railPeople } : null,
    signupIds: people ? inRail(others, now, 1).map((p) => p.id) : null,
  };
}
