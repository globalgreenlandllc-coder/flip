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
/** Shown only to an admin (lib/admin/access.ts). */
export const ADMIN: Item[] = [{ href: "/app/admin", label: "Admin", icon: "chart" }];

const isActive = (item: Item, pathname: string) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.also ?? []).some((a) => pathname.startsWith(a));

/** What the top bar calls the page you are on. */
export function pageName(pathname: string): string {
  if (/^\/app\/deals\/[^/]+$/.test(pathname)) return "Deal";
  const item = [...WORKSPACE, ...TOOLS, ...ADMIN].find((i) => isActive(i, pathname));
  return item?.label ?? "Workspace";
}

function Count({ n, rail }: { n?: number; rail: boolean }) {
  if (typeof n !== "number" || n <= 0) return null;
  return (
    <span
      className={rail ? "absolute right-2 top-1.5 min-w-[18px] rounded-full bg-orange px-1 text-center text-[10px] font-bold leading-[18px] text-[#111416]" : "rounded-full bg-orange px-2 text-xs font-bold leading-5 text-[#111416]"}
      data-deal-count
    >
      {n}
    </span>
  );
}

/**
 * The workspace's links. `rail`: the dark rail on the left of a wide screen, each link an icon over its name (the
 * design's rail). `list`: the phone menu, each link a row.
 */
function NavList({ items, pathname, dealCount, onNavigate, variant }: { items: Item[]; pathname: string; dealCount?: number; onNavigate?: () => void; variant: "rail" | "list" }) {
  const rail = variant === "rail";
  return (
    <ul className={rail ? "flex flex-col items-center gap-1.5" : "flex flex-col gap-1"}>
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <li key={item.href} className={rail ? "w-full" : undefined}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              data-nav={item.label}
              className={
                rail
                  ? `relative mx-auto flex w-[76px] flex-col items-center gap-1.5 rounded-[9px] px-1 py-2.5 text-center text-[11px] leading-tight transition-colors ${active ? "bg-[#26323b] font-semibold text-white before:absolute before:-left-[10px] before:top-1/2 before:h-7 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-orange" : "text-[#8f9ca2] hover:bg-[#1c2731] hover:text-white"}`
                  : `flex min-h-11 items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-colors ${active ? "bg-[#26323b] font-bold text-white" : "font-medium text-[#b3bdc2] hover:bg-[#1c2731] hover:text-white"}`
              }
            >
              <Icon name={item.icon} className={rail ? "h-[21px] w-[21px]" : "h-[18px] w-[18px]"} />
              <span className={rail ? "block" : "flex-1"}>{item.label}</span>
              {item.href === "/app/deals" && <Count n={dealCount} rail={rail} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The workspace's links: the workspace, then the tools, and for an admin the admin page. */
export function AppNav({ dealCount, admin = false, onNavigate, variant = "list" }: { dealCount?: number; admin?: boolean; onNavigate?: () => void; variant?: "rail" | "list" }) {
  const pathname = usePathname();
  const rail = variant === "rail";
  const heading = (text: string, first = false) =>
    rail ? <div className={`mx-auto w-9 border-t border-[#2b3640] ${first ? "hidden" : "my-3"}`} aria-hidden /> : <p className={`eyebrow mx-3.5 mb-3 text-[11px] text-[#7f8c92] ${first ? "mt-2" : "mt-7"}`}>{text}</p>;
  return (
    <nav aria-label="Workspace" className="flex flex-col">
      {heading("Your workspace", true)}
      <NavList items={WORKSPACE} pathname={pathname} dealCount={dealCount} onNavigate={onNavigate} variant={variant} />
      {heading("Tools")}
      <NavList items={TOOLS} pathname={pathname} onNavigate={onNavigate} variant={variant} />
      {admin && (
        <>
          {heading("Owner")}
          <NavList items={ADMIN} pathname={pathname} onNavigate={onNavigate} variant={variant} />
        </>
      )}
    </nav>
  );
}

/** "Workspace / Overview": where you are, over every page. */
export function Crumb() {
  const pathname = usePathname();
  const name = pageName(pathname);
  const inDeal = /^\/app\/deals\/[^/]+$/.test(pathname);
  return (
    <nav aria-label="Where you are" className="flex min-w-0 items-center gap-2.5 text-sm">
      <Link href="/app" className="text-ink-500 hover:text-ink-950">Workspace</Link>
      {inDeal && (
        <>
          <span className="text-ink-300" aria-hidden>/</span>
          <Link href="/app/deals" className="text-ink-500 hover:text-ink-950">My deals</Link>
        </>
      )}
      <span className="text-ink-300" aria-hidden>/</span>
      <span className="truncate font-semibold text-ink-900" data-crumb>{name}</span>
    </nav>
  );
}
