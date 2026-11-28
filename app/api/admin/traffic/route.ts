import { currentUser } from "@clerk/nextjs/server";
import { kind } from "@/lib/data/asker";
import { adminEmails, isAdmin } from "@/lib/admin/access";
import { loadTraffic, parseQuery, type TrafficData } from "@/lib/admin/traffic-server";

export const dynamic = "force-dynamic";

/** One answer per query, kept this long on this copy of the server: a page polling every 15 s costs one read. */
const FRESH_MS = 10_000;
const kept = new Map<string, { at: number; data: TrafficData }>();
const KEEP_MAX = 40;

const notFound = () => Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * The admin Traffic view's live data (app/app/admin/traffic polls it). Only for an admin, checked exactly as the page
 * checks (lib/admin/access.ts): anyone else, signed in or not, is told there is nothing here. A refresh that fails
 * answers with the last good data, marked stale.
 */
export async function GET(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user || !isAdmin(user, adminEmails())) return notFound();
  const url = new URL(req.url);
  const q = parseQuery((k) => url.searchParams.get(k));
  const key = `${user.id}|${q.span}|${q.audience}|${q.source ?? ""}|${q.mine ? 1 : 0}|${q.rail}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return Response.json(hit.data, { headers: { "Cache-Control": "no-store" } });
  try {
    const data = await loadTraffic(q, user.id);
    kept.set(key, { at: Date.now(), data });
    if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value as string);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[traffic] could not refresh", kind(err));
    if (hit) return Response.json({ ...hit.data, stale: true }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "The traffic could not be read just now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
