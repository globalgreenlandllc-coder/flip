import { notFound } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { kind } from "@/lib/data/asker";
import { adminEmails, isAdmin } from "@/lib/admin/access";
import { loadTraffic, parseQuery } from "@/lib/admin/traffic-server";
import { mapTiles } from "@/lib/map-tiles";
import { AdminSwitch } from "@/components/admin/admin-switch";
import { TrafficLive } from "@/components/admin/traffic-live";

export const metadata = { title: "Traffic" };
export const dynamic = "force-dynamic";

/**
 * Who is on RenoFlip right now and what each visitor does (the owner's ask of 2026-11-27, after JobFlex's Traffic
 * page). Only for an admin, as the Overview: anyone else is told there is no such page.
 */
export default async function TrafficPage() {
  const user = await currentUser();
  if (!user || !isAdmin(user, adminEmails())) notFound();
  const initial = await loadTraffic(parseQuery(() => null), user.id).catch((err: unknown) => {
    console.error("[traffic] the first read failed", kind(err));
    return null;
  });

  return (
    <div className="flex min-w-0 flex-col gap-7" data-traffic>
      <AdminSwitch on="traffic" />
      <div className="min-w-0">
        <p className="kicker text-ink-500">Owner · Traffic</p>
        <h1 className="mt-5 text-[40px] font-bold leading-[1.02] tracking-[-0.055em] text-ink-950 sm:text-[52px] xl:text-[60px]">
          Who is here.
          <br />
          <span className="text-[#7d878c]">What they do.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-500">
          People signed in show with their name, with each page, its time, the city, the device, the browser or app, and the site or ad that sent them. Visitors who are not signed in show the same without a name, under a code that changes every day, and their pages are never put under anyone&apos;s name. Times are Pacific, and your own visits are left out of every number.
        </p>
      </div>
      <TrafficLive initial={initial} tiles={mapTiles()} />
    </div>
  );
}
