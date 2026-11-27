import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { DEFAULT_DEAL_TERMS } from "@/lib/engine/defaults";

const POINTS = [
  `The most you can offer for a $${DEFAULT_DEAL_TERMS.targetProfit.toLocaleString("en-US")} profit`,
  "A renovation plan read from the listing's photos, room by room",
  "What homes like it sold for, from public records, every sale listed",
];

/** How the Clerk form sits in the shell: no card of its own, no title of its own, no second "sign up" link. */
export const CLERK_IN_SHELL = {
  elements: { rootBox: "w-full", cardBox: "w-full shadow-none", headerTitle: "hidden", headerSubtitle: "hidden", footerAction: "hidden" },
};

/**
 * Sign-in and sign-up, in the light edition's palette (the design has no sign-in screen of its own): the headline and
 * three plain points on the left, the form in a white card on the right.
 */
export function AuthShell({ title, subtitle, children, swap }: { title: string; subtitle: string; children: React.ReactNode; swap: { text: string; href: string; label: string } }) {
  return (
    <div className="grid flex-1 grid-cols-1 bg-[#f7f8fa] text-[#141820] lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden border-r border-[#dfe3e8] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Logo />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#5d6574]">A clearer way to look at a flip</p>
          <p className="mt-5 text-[56px] font-bold leading-[1.04] tracking-[-0.065em]">
            Know what to pay.
            <br />
            <span className="text-[#7a818d]">See what you keep.</span>
          </p>
          <ul className="mt-9 space-y-3.5 text-[15px] text-[#3d4452]">
            {POINTS.map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange text-[#111416]">
                  <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-[#596170]">Estimates, not appraisals. Free during beta.</p>
      </aside>
      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-sm">
          <h1 className="text-[30px] font-bold tracking-[-0.045em]">{title}</h1>
          <p className="mb-6 mt-1.5 text-[#596170]">{subtitle}</p>
          {children}
          <p className="mt-6 text-center text-sm text-[#596170]">
            {swap.text}{" "}
            <Link href={swap.href} className="font-bold text-[#b9411d] hover:underline" data-auth-swap>
              {swap.label}
            </Link>
          </p>
          <p className="mt-8 text-center text-xs text-[#626a77]">
            <Link href="/" className="hover:text-[#141820]">
              Back to RenoFlip&apos;s home page
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
