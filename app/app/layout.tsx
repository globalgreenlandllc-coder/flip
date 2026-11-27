import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Logo } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { AppNav, Crumb } from "@/components/app/nav";
import { MobileMenu } from "@/components/app/mobile-menu";
import { db } from "@/lib/db";
import { adminEmails, isAdmin } from "@/lib/admin/access";

/** How many deals this person has saved, for the sidebar. A database that cannot say leaves the number off. */
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
  const email = user?.primaryEmailAddress?.emailAddress;
  // The Admin link shows only to an admin; the page itself checks again (app/app/admin/page.tsx).
  const admin = isAdmin(user, adminEmails());

  return (
    <div className="flex flex-1">
      <aside className="hidden w-[232px] shrink-0 border-r border-ink-200 bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-[18px] pb-5 pt-7">
        <Logo href="/app" className="mx-3.5 mb-7 self-start" />
        <AppNav dealCount={dealCount} admin={admin} />
        <div className="mt-auto pt-6">
          <div className="rounded-xl border border-[#e6ebdf] bg-[#f3f6ef] px-3.5 py-4">
            <Icon name="shield" className="mb-2.5 h-5 w-5 text-[#76975d]" />
            <p className="text-[13px] font-bold leading-snug text-ink-900">Confidence comes from the details.</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[#728069]">Read the sold homes behind each value and what to check before you offer.</p>
          </div>
          <div className="mt-5 flex items-center gap-3 border-t border-ink-200 px-2 pt-4">
            <UserButton />
            <div className="min-w-0 text-sm">
              <div className="truncate font-bold text-ink-900">{name}</div>
              <div className="truncate text-xs text-ink-500">{email && email !== name ? email : "Free during beta"}</div>
            </div>
          </div>
        </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* A solid header, no backdrop blur: a backdrop filter would make the header the frame of the phone menu's
            fixed panel, and the panel would open with no height (the review of 2026-11-27). */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ink-200 bg-white px-4 sm:px-6 lg:h-[72px] lg:px-9">
          <div className="min-w-0 lg:hidden">
            <MobileMenu dealCount={dealCount} admin={admin} />
          </div>
          <div className="hidden min-w-0 lg:block">
            <Crumb />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-ink-500 sm:inline-flex">
              <Icon name="info" className="h-4 w-4" />
              Free during beta
            </span>
            <div className="lg:hidden">
              <UserButton />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-7 sm:px-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
