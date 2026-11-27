import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { kind } from "@/lib/data/asker";
import { adminEmails, isAdmin } from "@/lib/admin/access";
import { KEEP_DAYS } from "./visit";

const DAY_MS = 86_400_000;

/** Where the day's key is kept: the providers' answer table (model DataCache), under its own name. */
const KEY_PROVIDER = "visits";
const keyName = (day: string) => `visits:key:${day}`;

/** The visit came after its day was over (a page seen at 23:59:59 reported after midnight): it is not kept. */
export class DayOver extends Error {
  constructor() {
    super("the day is over");
    this.name = "DayOver";
  }
}

let dayKey: { day: string; key: string } | null = null;

/**
 * The day's random key for the visitor fingerprints (lib/visits/visit.ts visitorId). Made by the first visit of the
 * day and shared through the database, so every copy of the server running that day uses the same one.
 *
 * Each copy of the server, the first time it needs a day's key, also deletes the earlier days' keys (after which their
 * fingerprints can no longer be worked back to an address; the database provider's own backups keep them for their
 * restore window) and the visits past KEEP_DAYS. A key is made only for the newest day: once a later day's key
 * exists, a visit of an earlier day is not kept, so a deleted key is never made again.
 */
export async function keyOfTheDay(day: string, now: Date): Promise<string> {
  if (dayKey?.day === day) return dayKey.key;
  const name = keyName(day);
  let row = await db.dataCache.findUnique({ where: { key: name }, select: { payload: true } });
  if (!row) {
    if (await db.dataCache.findFirst({ where: { provider: KEY_PROVIDER, key: { gt: name } }, select: { key: true } })) throw new DayOver();
    try {
      row = await db.dataCache.create({
        // Expires two days on: the answer table's sweep may delete it then, should no visit come to do it sooner.
        data: { key: name, provider: KEY_PROVIDER, fetchedAt: now, expiresAt: new Date(now.getTime() + 2 * DAY_MS), payload: randomBytes(32).toString("hex") },
        select: { payload: true },
      });
    } catch {
      // Another copy of the server made it at the same moment.
      row = await db.dataCache.findUnique({ where: { key: name }, select: { payload: true } });
    }
  }
  if (!row) throw new Error("the day's key could not be made");
  // Separately: a failure here loses nothing of the visit, and the next copy of the server to start tries again.
  try {
    await db.dataCache.deleteMany({ where: { provider: KEY_PROVIDER, key: { lt: name } } });
    await db.visit.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY_MS) } } });
  } catch (err) {
    console.error("[visit] the earlier days were not cleared", kind(err));
  }
  dayKey = { day, key: row.payload };
  return row.payload;
}

let known: { at: number; ids: Set<string> | null } | null = null;
const KNOWN_FOR_MS = 10 * 60_000;
const UNKNOWN_FOR_MS = 60_000;

/**
 * The accounts of the admins (FLIP_ADMIN_EMAILS, verified addresses only), asked of the sign-in service at most every
 * ten minutes. Null when it could not be asked (then asked again after a minute, not on every visit).
 */
export async function adminIds(now = Date.now()): Promise<Set<string> | null> {
  const admins = adminEmails();
  if (admins.size === 0) return new Set();
  if (known && now - known.at < (known.ids ? KNOWN_FOR_MS : UNKNOWN_FOR_MS)) return known.ids;
  try {
    const client = await clerkClient();
    const res = await client.users.getUserList({ emailAddress: [...admins], limit: 100 });
    known = { at: now, ids: new Set(res.data.filter((u) => isAdmin(u, admins)).map((u) => u.id)) };
  } catch (err) {
    console.error("[visit] the admins could not be read", kind(err));
    known = { at: now, ids: null };
  }
  return known.ids;
}
