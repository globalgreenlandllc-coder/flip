import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Mark, Wordmark } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { AppNav, Crumb } from "@/components/app/nav";
import { MobileMenu } from "@/components/app/mobile-menu";
import { db } from "@/lib/db";
import { adminEmails, isAdmin } from "@/lib/admin/access";

/** How many deals this person has saved, for the rail. A database that cannot say leaves the number off. */
async function savedDeals(userId: string | null): Promise<number | undefined> {
  if (!userId) return undefined;
  try {
    return await db.deal.count({ where: { userId } });
  } catch (err) {
    console.error("[app] could not count deals", err);
    return undefined;
  }
}

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const [user, { userId }] = await Promise.all([currentUser(), auth()]);
  const dealCount = await savedDeals(userId);
  const name = user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Your workspace";
  // The Admin link shows only to an admin; the page itself checks again (app/app/admin/page.tsx).
  const admin = isAdmin(user, adminEmails());

  return (
    <div className="flex flex-1">
      {/* The design's dark rail: the mark, each page an icon over its name, the account at the foot. */}
      <aside className="on-night hidden w-[96px] shrink-0 bg-ink-950 lg:block">
        <div className="sticky top-0 flex h-screen flex-col items-center overflow-y-auto pb-5 pt-5">
          <Link href="/app" aria-label="RenoFlip workspace" className="mb-7">
            <Mark className="h-11 w-11" />
          </Link>
          <AppNav dealCount={dealCount} admin={admin} variant="rail" />
          <div className="mt-auto flex flex-col items-center gap-2 pt-6" title={name}>
            <UserButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* A solid header, no backdrop blur: a backdrop filter would make the header the frame of the phone menu's
            fixed panel, and the panel would open with no height (the review of 2026-11-27). */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ink-200 bg-canvas px-4 sm:px-6 lg:h-[72px] lg:px-10">
          <div className="min-w-0 lg:hidden">
            <MobileMenu dealCount={dealCount} admin={admin} />
          </div>
          <div className="hidden min-w-0 items-center gap-5 lg:flex">
            <Link href="/app" aria-label="RenoFlip workspace" className="shrink-0">
              <Wordmark size="sm" />
            </Link>
            <Crumb />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-500 sm:inline-flex">
              <Icon name="info" className="h-3.5 w-3.5" />
              Free during beta
            </span>
            <span className="hidden max-w-[200px] truncate text-sm font-semibold text-ink-900 xl:block">{name}</span>
            <div className="lg:hidden">
              <UserButton />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-7 sm:px-8 lg:px-11 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
