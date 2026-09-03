import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { Logo } from "@/components/ui/logo";
import { VerdictBadge } from "@/components/ui/verdict";
import { HeroCard } from "@/components/landing/hero-card";
import { Showcase } from "@/components/landing/showcase";
import { PhotoRead } from "@/components/landing/photo-read";
import { PHOTOS } from "@/components/landing/photos";
import { StressTest } from "@/components/landing/stress-test";
import { Reveal } from "@/components/landing/reveal";
import { RemodelPlan } from "@/components/landing/remodel-plan";

const QUESTIONS = [
  { q: "What's the ceiling here?", a: "The top of this block's market. No finish level pushes a house past it, and most flippers lose money by ignoring it." },
  { q: "What does the finished version sell for?", a: "ARV from sold comps matched on size, beds, baths, age and lot, adjusted line by line and for time." },
  { q: "What does it need?", a: "Every room scored from the listing photos, with what to fix and what to leave alone." },
  { q: "What does that cost?", a: "Line-item rehab, low / likely / high, plus a reserve for what photos cannot show." },
  { q: "Does the money work?", a: "ARV minus purchase, rehab, holding, financing and closing on both ends. Profit, ROI, and the most you can pay." },
];

const STEPS = [
  { n: "1", t: "Paste the listing", d: "Drop in the link and the photos. Add the asking price if the page won't give it up.", icon: "M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" },
  { n: "2", t: "flip runs the numbers", d: "Comps, ceiling, photo assessment, remodel plan and deal math, in about a minute.", icon: "M4 19h16M6 16l4-5 3 3 5-7M17 7h2v2" },
  { n: "3", t: "Read the verdict", d: "GO, TIGHT or PASS with the one number that decided it, and a report you can hand to a partner or lender.", icon: "M9 12l2 2 4-4M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" },
];

const AUDIENCES = [
  { t: "Contractors", d: "You already know what a kitchen costs. flip tells you what the block will pay for it, so you can bring a deal to an investor with a report and win the renovation.", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" },
  { t: "Investors", d: "Stop losing money on ARV. Every comp and every adjustment is on the page, the ceiling is enforced, and the max offer is solved for your target profit.", icon: "M3 17l6-6 4 4 8-8M14 7h7v7" },
  { t: "Agents & lenders", d: "Score every listing your investor clients look at. White-label reports for agents, an API for platforms, and a published accuracy number for your metro.", icon: "M4 4h16v12H5.5L4 17.5V4zM8 9h8M8 12h5" },
];

const FAQ = [
  { q: "Is this an appraisal?", a: "No. It is a decision tool built the way a good appraiser and a good flipper think: comps with visible adjustments, a ceiling for the neighborhood, and deal math with every assumption editable. Verify before you close." },
  { q: "Where do the comps come from?", a: "Public assessor and recorded-sale data, and MLS data where we have a licensed feed. We do not scrape listing portals. The listing link is read for its public page details and photos only." },
  { q: "How accurate is the ARV?", a: "We backtest against completed flips in each metro before we turn it on there: the model sees only what was known on purchase day, and we compare its ARV to the actual resale. The accuracy number for your metro is on your dashboard." },
  { q: "What if the listing site blocks the link?", a: "Some portals block automated reads some of the time. When that happens the page says so and you drop the photos in directly. Everything else works the same." },
  { q: "Who can see my deals?", a: "Only you, and anyone you share a report with. Photos are analyzed and not used for anything else." },
];

const NAV_LINKS = [
  ["#report", "The report"],
  ["#plan", "Remodel plan"],
  ["#stress", "Stress test"],
  ["#ceiling", "The ceiling"],
  ["#pricing", "Pricing"],
  ["#faq", "FAQ"],
] as const;

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-ink-200/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-medium text-ink-700 md:flex">
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-ink-950">{label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {signedIn ? (
            <Link href="/app" className="btn-primary text-sm">Open the app</Link>
          ) : (
            <>
              <Link href="/sign-in" className="hidden text-sm font-medium text-ink-700 transition-colors hover:text-ink-950 sm:block">Sign in</Link>
              <Link href="/sign-up" className="btn-primary text-sm">Get started</Link>
            </>
          )}
          <details className="mnav relative md:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-900" aria-label="Menu">
              <svg className="mnav-open h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              <svg className="mnav-close h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </summary>
            <nav className="absolute right-0 top-11 w-56 rounded-2xl border border-ink-200 bg-white p-2 text-sm font-medium text-ink-900 shadow-[0_24px_60px_-24px_rgb(11_18_32/0.4)]">
              {NAV_LINKS.map(([href, label]) => (
                <a key={href} href={href} className="block rounded-lg px-3 py-2 hover:bg-ink-100">{label}</a>
              ))}
              {!signedIn && <Link href="/sign-in" className="block rounded-lg px-3 py-2 hover:bg-ink-100 sm:hidden">Sign in</Link>}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function Check() {
  return (
    <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
  );
}

function Icon({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
  );
}

function ReportMock() {
  return (
    <div className="card overflow-hidden text-sm shadow-[0_30px_80px_-40px_rgb(11_18_32/0.4)]">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-3"><VerdictBadge verdict="TIGHT" size="sm" /><span className="font-medium">Hits target at base case but loses $16,100 if ARV drops 10% and rehab runs 20% over.</span></div>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Comps · 5 within 0.5 mi / 6 mo</div>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {[["$1,131,421", "$1,088,022", "1,890 sqft · renovated · 0.34 mi"], ["$969,726", "$981,301", "1,774 sqft · renovated · 0.27 mi"], ["$956,546", "$1,016,461", "1,820 sqft · updated · 0.26 mi"]].map(([s, a, d]) => (
                <tr key={s} className="border-t border-ink-100">
                  <td className="py-1.5 pr-3 tabular-nums text-ink-500">{s}</td>
                  <td className="py-1.5 pr-3 font-medium tabular-nums">{a}</td>
                  <td className="py-1.5 text-ink-500">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Sensitivity · profit</div>
          <table className="mt-2 w-full text-xs">
            <thead className="text-ink-500"><tr><th className="py-1 text-left font-medium">ARV \ rehab</th><th className="py-1 text-right font-medium">+0%</th><th className="py-1 text-right font-medium">+10%</th><th className="py-1 text-right font-medium">+20%</th></tr></thead>
            <tbody>
              {[["0%", "$103,406", "$94,199", "$84,991"], ["−5%", "$52,813", "$43,606", "$34,398"], ["−10%", "$2,220", "−$6,988", "−$16,195"]].map((r) => (
                <tr key={r[0]} className="border-t border-ink-100">
                  {r.map((c, i) => <td key={i} className={`py-1.5 tabular-nums ${i ? "text-right" : ""} ${c.startsWith("−$") ? "text-pass" : ""}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border-t border-ink-100 bg-ink-100/40 px-5 py-3 text-xs text-ink-700">
        <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-700 ring-1 ring-ink-200">PHOTO_RED_FLAG</span>
        Two separate dated kitchens shown: possible non-conforming second unit. Verify legal use and permits.
      </div>
    </div>
  );
}

export default async function Landing() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);
  const primaryHref = signedIn ? "/app" : "/sign-up";
  const primaryLabel = signedIn ? "Open the app" : "Analyze your first house free";

  return (
    <div className="flex-1">
      <Nav signedIn={signedIn} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(rgb(11_18_32/0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 lg:pt-24">
          <div>
            <span className="fade-up inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Built for flippers, contractors and their lenders
            </span>
            <h1 className="fade-up mt-6 text-5xl font-bold leading-[1.02] tracking-tight text-ink-950 sm:text-6xl lg:text-[4.25rem]" style={{ animationDelay: "60ms" }}>
              Know it&apos;s a good flip <span className="text-ink-400">before</span> you offer.
            </h1>
            <p className="fade-up mt-6 max-w-xl text-lg leading-relaxed text-ink-700" style={{ animationDelay: "120ms" }}>
              Paste the listing, add the photos. flip tells you GO, TIGHT or PASS, what the house will sell for, what the block will actually pay for, and what to remodel for the most profit.
            </p>
            <div className="fade-up mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
              <Link href={primaryHref} className="btn-primary px-5 py-3">{primaryLabel}</Link>
              <a href="#report" className="btn-secondary px-5 py-3">See a report</a>
            </div>
            <p className="fade-up mt-4 text-xs text-ink-500" style={{ animationDelay: "220ms" }}>No card. Free during beta. About a minute per house.</p>
            <div className="fade-up mt-10 grid gap-2 text-sm text-ink-700 sm:grid-cols-3 lg:grid-cols-1" style={{ animationDelay: "260ms" }}>
              {([["GO", "the money works, even at ARV −10%"], ["TIGHT", "works at asking, not at your target"], ["PASS", "you would lose money"]] as const).map(([v, t]) => (
                <div key={v} className="flex items-center gap-2.5 rounded-xl border border-ink-200/70 bg-white/70 px-3 py-2">
                  <VerdictBadge verdict={v} size="sm" />
                  <span className="text-[13px] leading-snug">{t}</span>
                </div>
              ))}
            </div>
          </div>
          <HeroCard />
        </div>
      </section>

      <Showcase />

      {/* Five questions */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">The method</div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Five questions, answered on every house</h2>
          <p className="mt-3 leading-relaxed text-ink-700">A flip goes wrong when one of these is guessed. flip answers all five with the work shown.</p>
        </div>
        <Reveal className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {QUESTIONS.map((x, i) => (
            <div key={x.q} className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white p-5">
              <div aria-hidden className="absolute -right-2 -top-4 text-7xl font-bold tracking-tighter text-ink-100 select-none">0{i + 1}</div>
              <div className="relative">
                <div className="text-xs font-semibold text-brand-600">Question {i + 1}</div>
                <h3 className="mt-2 font-semibold leading-snug">{x.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{x.a}</p>
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      {/* The report */}
      <section id="report" className="border-y border-ink-200/70 bg-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-24">
            <div className="eyebrow">The report</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Every number, with the work shown</h2>
            <p className="mt-4 leading-relaxed text-ink-700">A verdict you cannot check is a guess with a font. Every report opens to the comps, the adjustments, the ceiling, the plan and the stress test, so a partner or a lender can argue with the inputs instead of the conclusion.</p>
            <ul className="mt-6 space-y-3 text-sm text-ink-700">
              {["Verdict and the one number that decided it", "ARV range with confidence, and every comp with every adjustment", "Neighborhood ceiling and where this house lands against it", "Room-by-room condition from the photos, with what to keep", "Remodel plan ranked by profit, with skips explained", "Max allowable offer at your target profit", "Sensitivity: ARV down 10%, rehab up 20%, still profitable?", "Risk flags: age, systems, and what photos cannot show"].map((t) => (
                <li key={t} className="flex gap-2.5"><Check />{t}</li>
              ))}
            </ul>
          </div>
          <ReportMock />
        </div>
      </section>

      <PhotoRead />

      {/* Remodel plan */}
      <section id="plan" className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">For contractors</div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Spend where the block pays. Stop where it doesn&apos;t.</h2>
          <p className="mt-3 leading-relaxed text-ink-700">
            flip prices every category against what buyers on this block actually pay for it. What is below par gets brought to par. What is already there is left alone. And when the neighborhood tops out, the plan says so before you put $35,000 into a kitchen the sale will not repay. Drag the ceiling and watch the plan change.
          </p>
        </div>
        <div className="mt-12">
          <RemodelPlan />
        </div>
        <p className="mt-4 text-xs text-ink-500">Sample house: 1,840 sqft, 3 bd / 2 ba, built 1952, dated condition, comps say $845,000 renovated. Unit costs are placeholders at contractor rates until calibrated for your metro.</p>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">How it works</div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">A listing in, a decision out.</h2>
        </div>
        <Reveal><ol className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="relative rounded-2xl border border-ink-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-950 text-white"><Icon d={s.icon} /></div>
                <span className="text-sm font-semibold text-ink-400">Step {s.n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">{s.d}</p>
            </li>
          ))}
        </ol></Reveal>
      </section>

      {/* Ceiling */}
      <section id="ceiling" className="bg-ink-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="eyebrow !text-brand-500">The number most calculators skip</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Every block has a ceiling. flip finds it.</h2>
            <p className="mt-5 leading-relaxed text-white/75">
              We take every renovated sale in the neighborhood over the last year and find the price per square foot the top decile clears. If the comp math says $700k but the block has never cleared $640k, the report says $640k, and tells you not to put a $60k kitchen in a house that will not pay for it.
            </p>
            <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 font-mono text-sm text-white/85">
              <div className="text-white/50">realistic ARV =</div>
              <div className="mt-1">min(comp-based ARV, ceiling × subject sqft)</div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between text-xs text-white/60"><span>Renovated sales, $/sqft, last 12 months</span><span>n = 43</span></div>
            <div className="mt-4 space-y-2.5">
              {[["Comp-based ARV", 108, "bg-white/40", "$700k"], ["Ceiling (top decile)", 100, "bg-brand-500", "$640k"], ["Median renovated", 88, "bg-white/25", "$565k"], ["This house, as-is", 78, "bg-white/15", "$500k"]].map(([label, w, c, v]) => (
                <div key={label as string}>
                  <div className="flex justify-between text-xs"><span className="text-white/80">{label}</span><span className="tabular-nums text-white/60">{v}</span></div>
                  <div className="mt-1 h-2.5 rounded-full bg-white/10"><div className={`h-full rounded-full ${c}`} style={{ width: `${Math.min(100, (w as number) * 0.9)}%` }} /></div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-relaxed text-white/70">The comps say $700k. The block says $640k. The report says $640k, and the remodel plan is sized to it: spend $28k, hit the median finish, sell fast.</p>
          </div>
        </div>
      </section>

      {/* Stress test */}
      <section id="stress" className="border-b border-ink-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <div className="eyebrow">Try the math</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Move the numbers. Watch the verdict.</h2>
            <p className="mt-3 leading-relaxed text-ink-700">
              This is the same deal math the report runs, live. Drag the asking price up and watch GO turn TIGHT, then PASS. In the app the comps set the ARV and the photos set the rehab; here you play both.
            </p>
          </div>
          <div className="mt-12">
            <StressTest />
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">Who it&apos;s for</div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Built for the people who put money into houses</h2>
        </div>
        <Reveal className="mt-12 grid gap-5 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.t} className="card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon d={a.icon} /></div>
              <h3 className="mt-5 text-lg font-semibold">{a.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">{a.d}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-y border-ink-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <div className="eyebrow">Pricing</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">One good decision pays for a year.</h2>
          </div>
          <Reveal className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              { name: "Starter", price: "Free", period: "during beta", d: "For your first deals.", items: ["Full reports with comps and remodel plan", "Saved deals", "Photo assessment"], cta: "Start free", featured: false, href: primaryHref },
              { name: "Pro", price: "$149", period: "per month", d: "For contractors and investors who run deals every week.", items: ["Unlimited analyses", "PDF reports with your logo", "Editable assumptions per deal", "Priority support"], cta: "Start free", featured: true, href: primaryHref },
              { name: "Team & API", price: "Talk to us", period: "", d: "For brokerages, lenders and platforms.", items: ["Score every listing over the API", "White-label reports", "Seats and shared deals", "Accuracy report for your metro"], cta: "Contact", featured: false, href: "mailto:hello@example.com" },
            ].map((t) => (
              <div key={t.name} className={`flex flex-col rounded-2xl border p-6 ${t.featured ? "border-ink-950 bg-ink-950 text-white shadow-[0_30px_60px_-30px_rgb(11_18_32/0.6)]" : "border-ink-200 bg-canvas"}`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">{t.name}</h3>
                  {t.featured && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-semibold text-white">Most popular</span>}
                </div>
                <div className="mt-4 text-3xl font-bold tracking-tight">{t.price} <span className={`text-sm font-normal ${t.featured ? "text-white/60" : "text-ink-500"}`}>{t.period}</span></div>
                <p className={`mt-2 text-sm ${t.featured ? "text-white/75" : "text-ink-700"}`}>{t.d}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {t.items.map((i) => <li key={i} className="flex gap-2.5"><Check />{i}</li>)}
                </ul>
                <Link href={t.href} className={`mt-6 ${t.featured ? "inline-flex items-center justify-center rounded-[0.625rem] bg-white px-4 py-2.5 font-semibold text-ink-950 transition-colors hover:bg-brand-50" : "btn-secondary"}`}>{t.cta}</Link>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
        <div className="eyebrow">FAQ</div>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Questions</h2>
        <div className="mt-8 divide-y divide-ink-200 border-y border-ink-200">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-ink-400 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-700">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-ink-950 px-8 py-20 text-center text-white sm:py-24">
          <Image
            src={PHOTOS.modernDusk}
            alt=""
            fill
            placeholder="blur"
            sizes="(min-width: 1152px) 1104px, 100vw"
            className="object-cover opacity-70"
          />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/95 via-ink-950/60 to-ink-950/20" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Run your next house through flip.</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/80">The report takes about a minute. The mistake it prevents takes months.</p>
            <Link href={primaryHref} className="mt-8 inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-ink-950 transition-colors hover:bg-brand-50">{primaryLabel}</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-200/70 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10 text-sm text-ink-500">
          <div>
            <Logo />
            <p className="mt-2 max-w-sm">Reports are estimates, not appraisals. Verify before you close.</p>
          </div>
          <nav className="flex gap-6">
            <a href="#report" className="hover:text-ink-950">The report</a>
            <a href="#pricing" className="hover:text-ink-950">Pricing</a>
            <a href="#faq" className="hover:text-ink-950">FAQ</a>
            <Link href="/sign-in" className="hover:text-ink-950">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
