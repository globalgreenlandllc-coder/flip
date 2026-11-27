"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";

interface Item {
  href: string;
  label: string;
  icon: IconName;
  /** Only this address, not the ones under it. */
  exact?: boolean;
  /** Also lit for these addresses. */
  also?: string[];
}

export const WORKSPACE: Item[] = [
  { href: "/app", label: "Overview", icon: "grid", exact: true },
  { href: "/app/analyze", label: "New analysis", icon: "sparkle" },
  { href: "/app/deals", label: "My deals", icon: "home" },
  { href: "/app/find", label: "Find deals", icon: "map" },
  { href: "/app/quick", label: "Quick numbers", icon: "calculator" },
];
export const TOOLS: Item[] = [{ href: "/app/extension", label: "Browser button", icon: "puzzle" }];

const isActive = (item: Item, pathname: string) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.also ?? []).some((a) => pathname.startsWith(a));

/** What the top bar calls the page you are on. */
export function pageName(pathname: string): string {
  if (/^\/app\/deals\/[^/]+$/.test(pathname)) return "Deal";
  const item = [...WORKSPACE, ...TOOLS].find((i) => isActive(i, pathname));
  return item?.label ?? "Workspace";
}

function NavList({ items, pathname, dealCount, onNavigate }: { items: Item[]; pathname: string; dealCount?: number; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              data-nav={item.label}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-colors ${active ? "bg-[#edf3ec] font-bold text-ink-950" : "font-medium text-[#708078] hover:bg-[#f7f9f7] hover:text-ink-950"}`}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/app/deals" && typeof dealCount === "number" && dealCount > 0 && (
                <span className="rounded border border-[#dce6dc] px-1.5 text-xs font-medium text-ink-700" data-deal-count>
                  {dealCount}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The sidebar's two lists: the workspace, then the tools. */
export function AppNav({ dealCount, onNavigate }: { dealCount?: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-col">
      <p className="eyebrow mx-3.5 mb-3 mt-2 text-[11px] text-ink-400">Your workspace</p>
      <NavList items={WORKSPACE} pathname={pathname} dealCount={dealCount} onNavigate={onNavigate} />
      <p className="eyebrow mx-3.5 mb-3 mt-7 text-[11px] text-ink-400">Tools</p>
      <NavList items={TOOLS} pathname={pathname} onNavigate={onNavigate} />
    </nav>
  );
}

/** "Workspace › Overview": where you are, over every page. */
export function Crumb() {
  const pathname = usePathname();
  const name = pageName(pathname);
  const inDeal = /^\/app\/deals\/[^/]+$/.test(pathname);
  return (
    <nav aria-label="Where you are" className="flex min-w-0 items-center gap-2.5 text-sm">
      <Link href="/app" className="text-ink-500 hover:text-ink-950">Workspace</Link>
      {inDeal && (
        <>
          <Icon name="chevron-right" className="h-3.5 w-3.5 text-ink-400" />
          <Link href="/app/deals" className="text-ink-500 hover:text-ink-950">My deals</Link>
        </>
      )}
      <Icon name="chevron-right" className="h-3.5 w-3.5 text-ink-400" />
      <span className="truncate font-semibold text-ink-900" data-crumb>{name}</span>
    </nav>
  );
}
