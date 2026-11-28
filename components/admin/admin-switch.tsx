import Link from "next/link";

const VIEWS = [
  { key: "overview", label: "Overview", href: "/app/admin" },
  { key: "traffic", label: "Traffic", href: "/app/admin/traffic" },
] as const;

/** The admin's two views, as the design's segmented control. Both keep the rail's one Admin item lit. */
export function AdminSwitch({ on }: { on: (typeof VIEWS)[number]["key"] }) {
  return (
    <nav aria-label="Admin views" className="flex w-fit rounded-[10px] bg-[#e9ebe5] p-1 text-sm" data-admin-switch>
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={v.href}
          aria-current={v.key === on ? "page" : undefined}
          className={`rounded-[7px] px-3.5 py-2 ${v.key === on ? "bg-ink-950 font-bold text-white" : "font-medium text-ink-700 hover:text-ink-950"}`}
          data-admin-view={v.key}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
