import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";

const POINTS = [
  "A renovation plan read from the listing's photos, room by room",
  "What homes like it sold for, from public records, every sale listed",
  "The most you can offer, and what to check before you do",
];

/** How the Clerk form sits in the shell: no card of its own, no title of its own, no second "sign up" link. */
export const CLERK_IN_SHELL = {
  elements: { rootBox: "w-full", cardBox: "w-full shadow-none", headerTitle: "hidden", headerSubtitle: "hidden", footerAction: "hidden" },
};

/** Sign-in and sign-up: the deep green panel with a house on the left, the form on the right. */
export function AuthShell({ title, subtitle, children, swap }: { title: string; subtitle: string; children: React.ReactNode; swap: { text: string; href: string; label: string } }) {
  return (
    <div className="grid grid-cols-1 flex-1 bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Image src="/brand/house-porch.jpg" alt="" fill priority sizes="50vw" className="object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/85 to-ink-950/40" />
        <div className="relative">
          <Logo tone="light" />
        </div>
        <div className="relative">
          <p className="eyebrow text-[#b2cbc0]">Built for remodelers</p>
          <p className="display mt-4 text-[52px]">
            See the potential.
            <br />
            <span className="text-lime">Know the profit.</span>
          </p>
          <ul className="mt-8 space-y-3.5 text-[15px] text-white/85">
            {POINTS.map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime text-ink-950">
                  <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/55">Estimates, not appraisals. Free during beta.</p>
      </aside>
      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-sm">
          <h1 className="text-[28px] font-bold tracking-[-0.04em] text-ink-900">{title}</h1>
          <p className="mb-6 mt-1.5 text-ink-500">{subtitle}</p>
          {children}
          <p className="mt-6 text-center text-sm text-ink-500">
            {swap.text}{" "}
            <Link href={swap.href} className="font-bold text-ink-950 hover:underline">
              {swap.label}
            </Link>
          </p>
          <p className="mt-8 text-center text-xs text-ink-400">
            <Link href="/" className="hover:text-ink-950">
              Back to Renoflip&apos;s home page
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
