import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { Logo } from "@/components/ui/logo";
import { AppNav } from "@/components/app/nav";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await currentUser();
  const name = user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Account";
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200/70 bg-white p-4 lg:flex">
        <Logo href="/app" className="px-2 py-1" />
        <div className="mt-6"><AppNav /></div>
        <div className="mt-auto flex items-center gap-3 rounded-lg border border-ink-200 p-2.5">
          <UserButton />
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{name}</div>
            {email && <div className="truncate text-xs text-ink-500">{email}</div>}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-ink-200/70 bg-white px-4 py-3 lg:hidden">
          <Logo href="/app" />
          <UserButton />
        </header>
        <div className="border-b border-ink-200/70 bg-white px-4 py-2 lg:hidden"><AppNav orientation="horizontal" /></div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
