import { Logo } from "@/components/ui/logo";

/** Split layout for sign-in and sign-up: brand panel left, Clerk form right. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid flex-1 lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-ink-950 p-10 text-white lg:flex">
        <Logo className="[&_span]:text-white" />
        <div>
          <p className="text-3xl font-bold leading-tight tracking-tight">Know it&apos;s a good flip before you offer.</p>
          <ul className="mt-8 space-y-3 text-white/75">
            {["GO / TIGHT / PASS with the number that decided it", "ARV from real comps, capped by the block's ceiling", "What to remodel, ranked by profit", "Every deal saved, ready to share"].map((t) => (
              <li key={t} className="flex gap-3"><span className="text-brand-500">✓</span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/50">Reports are estimates, not appraisals.</p>
      </aside>
      <main className="flex flex-col items-center justify-center px-6 py-12">
        <div className="mb-6 lg:hidden"><Logo /></div>
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 mb-6 text-ink-700">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
