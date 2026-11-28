import Link from "next/link";
import { notFound } from "next/navigation";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { PROVIDER, kind } from "@/lib/data/asker";
import { budgetUsed, dataBudgetFromEnv } from "@/lib/data/budget";
import { prismaDataStore } from "@/lib/data/prisma-data-store";
import { rentcastFromEnv } from "@/lib/data/house-data";
import { adminEmails, isAdmin } from "@/lib/admin/access";
import { dayKeys, onDays, perDay, pins, placeName, top, visitorCount, visitorsPerDay, withoutOwner, type Count, type VisitRow } from "@/lib/admin/stats";
import { mapTiles } from "@/lib/map-tiles";
import { visitsPerDay } from "@/lib/visits/visit";
import { DayBars } from "@/components/admin/day-bars";
import { VisitMap } from "@/components/admin/visit-map";
import { Icon, type IconName } from "@/components/ui/icon";
import { shortDay } from "@/components/ui/format";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;
const DAY_MS = 86_400_000;
/** The sign-in service gives its accounts in pages of at most 500; the newest 500 are read. */
const PEOPLE_READ = 500;
/** The most visits read for one view of the page; past it the page says so. */
const VISITS_READ = 200_000;

interface Person {
  id: string;
  name: string;
  email: string | null;
  createdAt: Date;
  lastSignInAt: Date | null;
  admin: boolean;
}

/** A read that may fail: the page says which part could not be read instead of falling over. */
async function read<T>(what: string, get: () => Promise<T>): Promise<T | null> {
  try {
    return await get();
  } catch (err) {
    console.error(`[admin] could not read ${what}`, kind(err));
    return null;
  }
}

async function people(admins: Set<string>): Promise<{ list: Person[]; total: number }> {
  const client = await clerkClient();
  const res = await client.users.getUserList({ limit: PEOPLE_READ, orderBy: "-created_at" });
  return {
    total: res.totalCount,
    list: res.data.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "",
      email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
      createdAt: new Date(u.createdAt),
      lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
      admin: isAdmin(u, admins),
    })),
  };
}

/**
 * One cell of the numbers, as the design's KPI grid (Deal Studio's "Buy at or below"): `dark` is the lead number's
 * cell. The cells share one box, split by lines.
 */
function Tile({ label, icon, value, note, dark = false }: { label: string; icon: IconName; value: string; note: string; dark?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2.5 px-4 py-5 sm:px-6 sm:py-6 ${dark ? "bg-ink-950 text-white" : "bg-[#f6f7f3]"}`} data-admin-tile={label}>
      <div className={`flex items-center justify-between gap-2 text-[13px] font-semibold ${dark ? "text-[#c3ccd0]" : "text-ink-700"}`}>
        <span>{label}</span>
        <Icon name={icon} className={`h-[18px] w-[18px] shrink-0 ${dark ? "text-orange" : "text-ink-400"}`} />
      </div>
      <p className={`tabular text-[30px] font-bold leading-none tracking-[-0.05em] sm:text-[38px] ${dark ? "text-white" : "text-ink-950"}`} data-admin-value>
        {value}
      </p>
      <p className={`text-xs leading-relaxed ${dark ? "text-[#c3ccd0]" : "text-ink-500"}`}>{note}</p>
    </div>
  );
}

function Unread({ what }: { what: string }) {
  return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-admin-unread>{what} could not be read just now. Reload the page to try again.</p>;
}

function CountList({ title, rows, unit, empty, label = (n) => n }: { title: string; rows: Count[] | null; unit: [string, string]; empty: string; label?: (name: string) => string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-ink-200 bg-white p-5 sm:p-6" data-admin-list={title}>
      <h2 className="text-[15px] font-bold tracking-tight text-ink-900">{title}</h2>
      {!rows ? (
        <Unread what="These numbers" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-500">{empty}</p>
      ) : (
        <ol className="divide-y divide-ink-100 text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex items-baseline justify-between gap-4 py-2">
              <span className="min-w-0 truncate text-ink-700">{label(r.name)}</span>
              <span className="tabular shrink-0 text-ink-900">
                {r.count.toLocaleString("en-US")} <span className="text-xs text-ink-500">{r.count === 1 ? unit[0] : unit[1]}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const n = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("en-US") : "—");

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([currentUser(), searchParams]);
  const admins = adminEmails();
  // Anyone else is told there is no such page.
  if (!user || !isAdmin(user, admins)) notFound();

  const asked = Number(Array.isArray(params.days) ? params.days[0] : params.days);
  const range: number = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  const now = new Date();
  const days = dayKeys(now, range);
  // A day more than the range, then cut to the area's days (lib/admin/stats.ts onDays).
  const since = new Date(now.getTime() - (range + 1) * DAY_MS);

  const [who, runs, deals, visits, firstVisit, lastDay, runsByPerson, dealsByPerson, lookups] = await Promise.all([
    read("the sign-ups", () => people(admins)),
    read("the analyses", () => db.usageRun.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, createdAt: true, kind: true, status: true } })),
    read("the saved deals", () => db.deal.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, createdAt: true } })),
    read("the visits", () =>
      db.visit.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, visitor: true, own: true, path: true, referrer: true, country: true, region: true, city: true, lat: true, lng: true },
        orderBy: { createdAt: "desc" },
        take: VISITS_READ,
      }),
    ),
    // Wrapped: null is "could not be read", { at: null } is "no visit yet".
    read("the first visit", async () => ({ at: (await db.visit.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }))?.createdAt ?? null })),
    read("the last 24 hours' visits", () => db.visit.count({ where: { createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })),
    read("each person's analyses", () => db.usageRun.groupBy({ by: ["userId", "kind"], where: { status: { not: "free" } }, _count: { _all: true } })),
    read("each person's deals", () => db.deal.groupBy({ by: ["userId"], _count: { _all: true } })),
    rentcastFromEnv() ? read("the sold-price lookups", () => budgetUsed(prismaDataStore, dataBudgetFromEnv(), PROVIDER, now)) : Promise.resolve(null),
  ]);

  // Everything here leaves the owner out: their visits (lib/admin/stats.ts withoutOwner), sign-up, analyses and deals.
  const ownIds = new Set([user.id, ...(who?.list.filter((p) => p.admin).map((p) => p.id) ?? [])]);
  const others = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => !ownIds.has(r.userId));
  const seen: VisitRow[] | null = visits ? withoutOwner(onDays(visits, days, (v) => v.createdAt)) : null;
  const visitsCut = visits?.length === VISITS_READ;
  const capReached = lastDay !== null && lastDay >= visitsPerDay();
  const paid = runs ? others(onDays(runs, days, (r) => r.createdAt)).filter((r) => r.status !== "free") : null;
  const analyses = paid?.filter((r) => r.kind === "analyze") ?? null;
  const quick = paid?.filter((r) => r.kind === "quick") ?? null;
  const users = paid ? new Set(paid.map((r) => r.userId)).size : null;
  const joined = who ? onDays(who.list, days, (p) => p.createdAt).filter((p) => !ownIds.has(p.id)) : null;
  const dealsIn = deals ? others(onDays(deals, days, (d) => d.createdAt)) : null;
  const mapPins = pins(seen ?? []);

  const runsOf = (id: string, k: string) => runsByPerson?.find((r) => r.userId === id && r.kind === k)?._count._all ?? 0;
  const dealsOf = (id: string) => dealsByPerson?.find((d) => d.userId === id)?._count._all ?? 0;

  return (
    <div className="flex flex-col gap-7" data-admin>
      {/* The design's workspace heading: the eyebrow with its orange line, a big two-tone headline. */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="kicker text-ink-500">Owner · Admin</p>
          <h1 className="mt-5 text-[40px] font-bold leading-[1.02] tracking-[-0.055em] text-ink-950 sm:text-[52px] xl:text-[60px]">
            Who comes.
            <br />
            <span className="text-[#7d878c]">What they use.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-500">Visitors, sign-ups and use of RenoFlip. Days are Pacific time, and your own account is left out.</p>
        </div>
        {/* The design's segmented control (its shortlist's "All 3 / Financial test passes / Needs attention"). */}
        <nav aria-label="Days shown" className="flex rounded-[10px] bg-[#e9ebe5] p-1 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/app/admin?days=${r}`}
              aria-current={r === range ? "page" : undefined}
              className={`rounded-[7px] px-3.5 py-2 ${r === range ? "bg-ink-950 font-bold text-white" : "font-medium text-ink-700 hover:text-ink-950"}`}
              data-admin-range={r}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-ink-200 bg-ink-200 lg:grid-cols-3">
        <Tile dark label="Visitors" icon="map" value={n(seen && visitorCount(seen))} note={seen ? `${n(seen.length)} pages seen. Each visitor is counted once a day.` : "The visits could not be read."} />
        <Tile label="Sign-ups" icon="plus" value={n(joined?.length)} note={who ? `${n(who.total)} accounts in all, yours included.` : "The sign-in service could not be read."} />
        <Tile label="People using it" icon="sparkle" value={n(users)} note={paid ? "Ran an analysis or Quick numbers." : "The analyses could not be read."} />
        <Tile label="Analyses" icon="camera" value={n(analyses?.length)} note={quick ? `And ${n(quick.length)} Quick numbers.` : "The analyses could not be read."} />
        <Tile label="Deals saved" icon="home" value={n(dealsIn?.length)} note={dealsIn ? "Saved to My deals." : "The saved deals could not be read."} />
        <Tile
          label="Sold-price lookups"
          icon="search"
          value={lookups ? `${n(lookups.used)} of ${n(lookups.of)}` : "—"}
          note={rentcastFromEnv() ? (lookups ? "RentCast, any 31 days in a row (RenoFlip's own limit). Yours included." : "The lookups could not be read.") : "Real sold prices are off: no RentCast key."}
        />
      </div>
      <p className="text-xs text-ink-500" data-admin-own>Your own account is left out of these numbers and charts: your visits, your sign-up, your analyses and your deals.</p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="admin-map">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-map" className="text-[22px] font-bold tracking-[-0.04em] text-ink-950">Where visitors come from</h2>
          <p className="text-xs text-ink-500" data-admin-since>
            {firstVisit?.at ? `Counted since ${shortDay(firstVisit.at)}.` : firstVisit && seen ? "No visits counted yet." : ""}
          </p>
        </div>
        {!seen && <Unread what="The visits" />}
        {capReached && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-admin-cap>
            The day&apos;s limit of {visitsPerDay().toLocaleString("en-US")} pages was reached in the last 24 hours, so later visits were not counted. So many pages in a day usually means a program, not people.
          </p>
        )}
        {visitsCut && <p className="text-xs text-amber-900" data-admin-cut>Only the newest {VISITS_READ.toLocaleString("en-US")} pages of these days are counted here: the earliest days may show fewer than they had.</p>}
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <VisitMap pins={mapPins} tiles={mapTiles()} />
          <CountList title="Top places" rows={seen && top(seen, placeName, 10)} unit={["visitor", "visitors"]} empty="No places yet." />
        </div>
        <p className="text-xs text-ink-500">The place is the city of the visitor&apos;s internet address, as Vercel reads it: close, not exact. Your own visits are left out, with the pages you saw that day before signing in.</p>
      </section>

      {/* items-start: a chart's table opened under it does not stretch the other two. */}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <DayBars title="Visitors a day" unit={["visitor", "visitors"]} days={days} values={seen && visitorsPerDay(seen, days)} />
        <DayBars title="Sign-ups a day" unit={["sign-up", "sign-ups"]} days={days} values={joined && perDay(joined.map((p) => p.createdAt), days)} note={who && who.total > PEOPLE_READ ? `The newest ${PEOPLE_READ} accounts are counted.` : undefined} />
        <DayBars title="Analyses a day" unit={["analysis", "analyses"]} days={days} values={analyses && perDay(analyses.map((r) => r.createdAt), days)} />
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <CountList title="Pages seen" rows={seen && top(seen, (v) => v.path, 10, false)} unit={["view", "views"]} empty="No pages seen yet." />
        <CountList title="Where they came from" rows={seen && top(seen.filter((v) => v.referrer), (v) => v.referrer ?? "", 10)} unit={["visitor", "visitors"]} empty="No other site has sent a visitor yet." />
      </div>

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="admin-people">
        <h2 id="admin-people" className="text-[22px] font-bold tracking-[-0.04em] text-ink-950">Newest sign-ups</h2>
        {!who ? (
          <Unread what="The sign-ups" />
        ) : who.list.length === 0 ? (
          <p className="text-sm text-ink-500">Nobody has signed up yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-ink-200 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm" data-admin-people>
              <thead className="bg-[#f6f7f3] text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Person</th>
                  <th className="px-4 py-3 font-medium">Signed up</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                  <th className="px-4 py-3 text-right font-medium">Analyses</th>
                  <th className="px-4 py-3 text-right font-medium">Quick numbers</th>
                  <th className="px-4 py-3 text-right font-medium">Deals saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {who.list.slice(0, 25).map((p) => (
                  <tr key={p.id} data-admin-person>
                    <td className="max-w-[260px] px-4 py-3">
                      <div className="truncate font-semibold text-ink-900">
                        {p.name || p.email || "No name"}
                        {p.admin && <span className="ml-2 rounded bg-[#fff1ea] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#b9411d]">You</span>}
                      </div>
                      {p.name && p.email && <div className="truncate text-xs text-ink-500">{p.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{shortDay(p.createdAt)}</td>
                    <td className="px-4 py-3 text-ink-700">{p.lastSignInAt ? shortDay(p.lastSignInAt) : "—"}</td>
                    <td className="tabular px-4 py-3 text-right">{runsByPerson ? runsOf(p.id, "analyze") : "—"}</td>
                    <td className="tabular px-4 py-3 text-right">{runsByPerson ? runsOf(p.id, "quick") : "—"}</td>
                    <td className="tabular px-4 py-3 text-right">{dealsByPerson ? dealsOf(p.id) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-500">Everyone who signed up, you too. Analyses, Quick numbers and deals are each person&apos;s all-time counts. An analysis the AI never answered is not counted.</p>
      </section>
    </div>
  );
}
