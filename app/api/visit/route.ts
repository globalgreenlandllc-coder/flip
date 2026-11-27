import { after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { kind } from "@/lib/data/asker";
import { DayOver, adminIds, keyOfTheDay } from "@/lib/visits/keep";
import { MAX_BODY, MAX_VISITS_AN_ADDRESS, MAX_VISITS_A_DAY, addressId, areaDay, cleanPath, clientAddress, fromOwnPage, looksLikeAProgram, placeFromHeaders, referrerHost, visitorId, visitsPerDay } from "@/lib/visits/visit";

const DAY_MS = 86_400_000;

/**
 * A page of this site was seen (components/visit-beacon.tsx sends it). Open to anyone, signed in or not, and always
 * answered the same way, kept or not: there is nothing here for a stranger to learn. The row is written after the
 * answer has gone (lib/visits/visit.ts says what is kept).
 */
export async function POST(req: Request) {
  const done = new Response(null, { status: 204 });
  const header = (name: string) => req.headers.get(name);
  if (!fromOwnPage(header)) return done;
  const userAgent = header("user-agent");
  if (looksLikeAProgram(userAgent)) return done;
  if (Number(header("content-length") ?? 0) > MAX_BODY) return done;
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return done;
  let body: { path?: unknown; ref?: unknown } | null = null;
  try {
    body = JSON.parse(text) as { path?: unknown; ref?: unknown };
  } catch {
    return done;
  }
  const path = cleanPath(body?.path);
  if (!path) return done;

  const userId = await auth().then(
    (a) => a.userId,
    () => null,
  );
  const at = new Date();
  const address = clientAddress(header);
  const place = placeFromHeaders(header);
  const referrer = referrerHost(body?.ref, header("host"));
  after(async () => {
    try {
      const key = await keyOfTheDay(areaDay(at), at);
      const visitor = visitorId(key, address, userAgent ?? "");
      const source = addressId(key, address);
      // Who is signed in is asked only to know the owner: no one's account is kept. When the sign-in service cannot
      // say, a signed-in visit is not kept, rather than count the owner as a visitor.
      let own = false;
      if (userId) {
        const admins = await adminIds();
        if (!admins) return;
        own = admins.has(userId);
      }
      // A fingerprint is one visitor's day, and an address fingerprint one address's day; then everyone's last 24 hours.
      if ((await db.visit.count({ where: { visitor } })) >= MAX_VISITS_A_DAY) return;
      if ((await db.visit.count({ where: { source } })) >= MAX_VISITS_AN_ADDRESS) return;
      if ((await db.visit.count({ where: { createdAt: { gte: new Date(at.getTime() - DAY_MS) } } })) >= visitsPerDay()) return;
      await db.visit.create({ data: { createdAt: at, path, visitor, source, own, referrer, ...place } });
    } catch (err) {
      if (!(err instanceof DayOver)) console.error("[visit] not kept", kind(err));
    }
  });
  return done;
}
