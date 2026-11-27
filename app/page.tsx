import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { limitsFromEnv } from "@/lib/usage/limits";
import { rentcastFromEnv } from "@/lib/data/house-data";
import { Logo } from "@/components/ui/logo";
import { Icon, type IconName } from "@/components/ui/icon";
import { VerdictBadge } from "@/components/ui/verdict";
import { Reveal } from "@/components/landing/reveal";
import { RemodelPlan } from "@/components/landing/remodel-plan";
import { DealExplorer } from "@/components/landing/deal-explorer";
import { SAMPLE_DEAL, money, runSample } from "@/components/landing/samples";
import porch from "@/public/brand/house-porch.jpg";
import kitchen from "@/public/brand/kitchen.jpg";

const steps = (realSales: boolean) => [
  { n: "1", t: "Paste the listing", d: "Drop in the link and the photos. Add the asking price if the page won't give it up." },
  { n: "2", t: "Renoflip runs the numbers", d: "What homes like it sold for, the block's ceiling, the photo reading, the remodel plan and the deal math, in about a minute." },
  {
    n: "3",
    t: "Read the plan and the verdict",
    d: realSales
      ? "GO, TIGHT or PASS with the one number that decided it (CHECK FIRST stands in for GO until the estimate is proven in your area), and a report you can hand to a partner or lender."
      : "GO, TIGHT or PASS with the one number that decided it, and a report you can hand to a partner or lender.",
  },
];

const features = (realSales: boolean): { icon: IconName; t: string; d: string }[] => [
  {
    icon: "home",
    t: "Understand the opportunity.",
    // Demo sales have no address or date: the claim is made only when real sold prices are on (the review of 2026-11-27).
    d: realSales ? "The house, the block and the homes like it that sold nearby, each sale with its address and date, in one clear view." : "The house, the block and the homes like it that sold nearby, in one clear view.",
  },
  { icon: "layers", t: "Renovate what matters.", d: "Every room read from the photos: what to keep, what to refresh, what to replace, matched to what the block pays for." },
  { icon: "chart", t: "See every number.", d: "Purchase, work, loan, holding and selling: all of it on the page, with the most you can offer worked out for your target profit." },
];

const audiences = (realSales: boolean): { icon: IconName; t: string; d: string }[] => [
  { icon: "tool", t: "Contractors", d: "You already know what a kitchen costs. Renoflip tells you what the block will pay for it, so you can bring a deal to an investor with a report and win the renovation." },
  {
    icon: "chart",
    t: "Investors",
    d: realSales
      ? "Stop losing money on ARV. Every comp and every adjustment is on the page, each sale with its address and date, the block's ceiling is shown beside the value, and the max offer is solved for your target profit."
      : "Stop losing money on ARV. Every comp and every adjustment is on the page, the ceiling is enforced, and the max offer is solved for your target profit.",
  },
  { icon: "file", t: "Agents & lenders", d: "Score every listing your investor clients look at. Planned: white-label reports for agents, an API for platforms, and a published accuracy number for your metro." },
];

/**
 * What the page says about where the numbers come from is what is true of this deployment: with real
 * sold prices connected (lib/data/house-data.ts) it says so and says what has not been tested yet;
 * without, it says the numbers are a demo.
 */
const faq = (realSales: boolean) => [
  { q: "Is this an appraisal?", a: "No. It is a decision tool built the way a good appraiser and a good flipper think: comps with visible adjustments, a ceiling for the neighborhood, and deal math with every assumption on the page. Verify before you close." },
  realSales
    ? { q: "Where do the comps come from?", a: "From county public records of sold homes, read through a data service. Each sale used is shown with its address, its date and its price, so you can check it. When a house cannot be looked up (no address, no record of it, or the month's lookups are used up), the result falls back to made-up demo data and is marked DEMO. The photo reading is always real." }
    : { q: "Where do the comps come from?", a: "In this beta they are demo data: the sales behind the resale numbers are made up, and every number built on them is marked DEMO. Real recorded-sale data is being connected next, one area at a time. The photo reading is real today." },
  realSales
    ? { q: "How accurate is the ARV?", a: "Not measured yet. The sold prices are real, but the method that turns them into a resale value has not been tested against completed flips in any area, and its adjustment rates are placeholders. So a result built on real sold prices is marked UNTESTED and is never a GO: where the numbers alone would say GO, it says CHECK FIRST. Before that changes in an area, the model is tested against completed flips there: it sees only what was known on purchase day, and its ARV is compared with the actual resale. That measured accuracy will be shown beside every ARV." }
    : { q: "How accurate is the ARV?", a: "Not measured yet, because the beta runs on demo sales. Before real numbers are turned on in an area, the model is tested against completed flips there: it sees only what was known on purchase day, and its ARV is compared with the actual resale. That measured accuracy will be shown beside every ARV." },
  { q: "What if the listing site blocks the link?", a: "Some portals block automated reads some of the time. When that happens the page says so and you drop the photos in directly, or use the browser button. Everything else works the same." },
  { q: "Who can see my deals?", a: "Only you. Photos are analyzed and not used for anything else, and Renoflip keeps no listing photos." },
];

const NAV_LINKS = [
  ["#how-it-works", "How it works"],
  ["#try-the-numbers", "Try the numbers"],
  ["#for-contractors", "For contractors"],
  ["#pricing", "Pricing"],
  ["#faq", "FAQ"],
] as const;

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-[76px] max-w-[1200px] items-center justify-between gap-6 px-5 sm:px-8">
        <Logo />
        <nav aria-label="On this page" className="hidden items-center gap-8 text-[15px] font-medium text-ink-700 lg:flex">
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-ink-950">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {signedIn ? (
            <Link href="/app" className="btn-primary">
              Open workspace
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="hidden text-[15px] font-semibold text-ink-700 transition-colors hover:text-ink-950 sm:block">
                Sign in
              </Link>
              <Link href="/sign-up" className="btn-primary">
                Get started
              </Link>
            </>
          )}
          <details className="mnav relative lg:hidden">
            <summary className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-900" aria-label="Menu">
              <Icon name="menu" className="mnav-open h-5 w-5" />
              <Icon name="close" className="mnav-close h-5 w-5" />
            </summary>
            <nav className="absolute right-0 top-13 w-60 rounded-2xl border border-ink-200 bg-white p-2 text-[15px] font-medium text-ink-900 shadow-[0_24px_60px_-24px_rgb(21_61_53_/_0.4)]">
              {NAV_LINKS.map(([href, label]) => (
                <a key={href} href={href} className="block rounded-lg px-3 py-2.5 hover:bg-ink-100">
                  {label}
                </a>
              ))}
              {!signedIn && (
                <Link href="/sign-in" className="block rounded-lg px-3 py-2.5 hover:bg-ink-100 sm:hidden">
                  Sign in
                </Link>
              )}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function Tick({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon name="check" className="h-4 w-4 text-brand-600" strokeWidth={2.2} />
      {children}
    </span>
  );
}

export default async function Landing() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);
  const primaryHref = signedIn ? "/app" : "/sign-up";
  const primaryLabel = signedIn ? "Open workspace" : "Analyze your first house free";
  // The number on the page is the number that is enforced.
  const { monthlyAnalyses } = limitsFromEnv();
  // Are real sold prices connected? The page says what is true either way.
  const realSales = rentcastFromEnv() !== null;
  const sample = runSample(SAMPLE_DEAL);

  return (
    <div className="flex-1 bg-white">
      <Nav signedIn={signedIn} />

      {/* Hero */}
      <section className="mx-auto grid grid-cols-1 max-w-[1240px] items-center gap-12 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.12fr_1fr] lg:gap-12 lg:pb-24 lg:pt-20">
        <div>
          <p className="fade-up eyebrow flex items-center gap-2 text-[#5f7b6b]">
            <Icon name="home" className="h-4 w-4" />
            Built for remodelers
          </p>
          <h1 className="fade-up display mt-6 text-[48px] text-ink-900 sm:text-[68px] lg:text-[64px] xl:text-[76px]" style={{ animationDelay: "60ms" }}>
            See the potential.
            <br />
            <span className="text-[#5f7b6b]">Know the profit.</span>
          </h1>
          <p className="fade-up mt-7 max-w-[34rem] text-lg leading-relaxed text-ink-500" style={{ animationDelay: "120ms" }}>
            Turn a property listing into a clear renovation plan, a smarter offer, and a deal worth doing.
          </p>
          <div className="fade-up mt-8 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "180ms" }}>
            <Link href={primaryHref} className="btn-primary px-6 py-3.5 text-[15px]">
              {primaryLabel}
            </Link>
            <a href="#how-it-works" className="inline-flex items-center gap-1.5 text-[15px] font-bold text-ink-950">
              See how it works <Icon name="chevron-right" className="h-4 w-4" />
            </a>
          </div>
          <div className="fade-up mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-500" style={{ animationDelay: "220ms" }}>
            <Tick>A plan read from the photos</Tick>
            <Tick>Your costs. Your margin.</Tick>
          </div>
          <p className="fade-up mt-6 max-w-[34rem] text-xs leading-relaxed text-ink-400" style={{ animationDelay: "260ms" }}>
            {realSales
              ? "No card. Free during beta. About a minute per house. The photo reading and the sold prices are real. The resale estimate built on them has not been accuracy-tested yet, so a result built on real sold prices is marked UNTESTED and is never a GO: where the numbers alone would say GO, it says CHECK FIRST. A house that cannot be looked up gets made-up demo numbers, marked DEMO."
              : "No card. Free during beta. About a minute per house. In the beta the photo reading is real; the sales behind the resale numbers are demo data, and every number built on them is marked DEMO."}
          </p>
        </div>

        <div className="relative">
          <div className="relative overflow-hidden rounded-[20px]">
            <Image src={porch} alt="A shingled house with a deep front porch" priority placeholder="blur" sizes="(min-width: 1024px) 600px, 100vw" className="aspect-[1.12] w-full object-cover" />
            <span className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-sm font-semibold text-ink-900">
              <Icon name="sparkle" className="h-4 w-4" />
              Potential, with a plan.
            </span>
          </div>
          <div className="pop-in relative -mt-24 ml-4 w-[min(300px,85%)] rounded-2xl border border-ink-200 bg-white p-5 shadow-[0_24px_50px_-20px_rgb(21_61_53_/_0.35)] sm:-mt-28 sm:ml-[-36px]" style={{ animationDelay: "350ms" }} data-hero-sample>
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-500">Profit at asking</p>
              <span className="rounded-md bg-[#eef4e6] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#5f7b55]">Sample</span>
            </div>
            <p className="tabular mt-1 text-[38px] font-bold tracking-[-0.04em] text-ink-900">{money(sample.profit)}</p>
            <p className="text-sm text-ink-500">before tax</p>
            <div className="mt-4 flex items-center justify-between border-t border-ink-200 pt-4">
              <span className="text-[15px] text-ink-700">Renovate with intention.</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef4e6] text-[#5f7b55]">
                <Icon name="chart" className="h-[18px] w-[18px]" />
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-400">A sample deal, worked out by Renoflip&apos;s own engine. Not a real listing.</p>
          </div>
        </div>
      </section>

      {/* Where listings come from */}
      <section className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 border-y border-ink-200 py-7">
          <div>
            <p className="eyebrow text-[#5f7b6b]">One link. A clearer picture.</p>
            <p className="mt-1.5 text-sm text-ink-500">Paste a listing from the sites you already use.</p>
          </div>
          <p className="text-lg font-bold tracking-tight text-ink-300 sm:text-xl">Zillow · Redfin · Realtor.com · Movoto · Estately · brokerage sites</p>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-[#5f7b6b]">Less guesswork. Better decisions.</p>
            <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900 sm:text-5xl">
              Your next deal,
              <br />
              with the full picture.
            </h2>
          </div>
          <p className="max-w-sm text-[15px] leading-relaxed text-ink-500">From the first listing to your final offer. Everything you need to decide, in one place.</p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div className="rounded-[18px] border border-ink-200 bg-[#f5f7f6] p-7">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-950">
                <Icon name="home" className="h-6 w-6" />
              </span>
              <div>
                <p className="text-lg font-bold text-ink-900">A new possibility.</p>
                <p className="text-sm text-ink-500">Start with a property listing.</p>
              </div>
            </div>
            <Link href={primaryHref} className="mt-6 flex items-center gap-3 rounded-[10px] border border-ink-200 bg-white px-4 py-3.5 text-sm text-[#9aa49d] hover:border-ink-300">
              <Icon name="link" className="h-5 w-5" />
              Paste a listing from Zillow or Redfin
            </Link>
            <Link href={primaryHref} className="btn-primary mt-3 w-full">
              {signedIn ? "Analyze a listing" : "Get started free"}
            </Link>
            <p className="eyebrow mt-7 text-center text-ink-400">One cohesive analysis</p>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-ink-700">
              <Tick>Comparable sales</Tick>
              <Tick>Renovation scope</Tick>
              <Tick>Financing costs</Tick>
              <Tick>Property risks</Tick>
            </div>
          </div>
          <Reveal className="space-y-9">
            {features(realSales).map((f) => (
              <div key={f.t} className="flex gap-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef4e6] text-[#5f7b55]">
                  <Icon name={f.icon} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-ink-900">{f.t}</h3>
                  <p className="mt-2 max-w-md leading-relaxed text-ink-500">{f.d}</p>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
        <Reveal>
          <ol className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-3">
            {steps(realSales).map((s) => (
              <li key={s.n} className="rounded-[16px] border border-ink-200 bg-white p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lime text-sm font-bold text-ink-950">{s.n}</span>
                <h3 className="mt-5 text-lg font-bold text-ink-900">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{s.d}</p>
              </li>
            ))}
          </ol>
        </Reveal>
        {/* What each verdict means. With real sold prices connected, CHECK FIRST stands where a GO would, until an area's accuracy test is passed. */}
        <div className="mt-6 grid grid-cols-1 gap-2.5 text-sm text-ink-700 sm:grid-cols-2 lg:grid-cols-4" data-verdict-key>
          {(
            [
              ["GO", "the money works, even at ARV −10%"],
              ["TIGHT", "works at asking, not at your target"],
              ["PASS", "you would lose money"],
              ...(realSales ? ([["CHECK FIRST", "the numbers work; the estimate is not proven here yet"]] as const) : []),
            ] as const
          ).map(([v, t]) => (
            <div key={v} className="flex items-center gap-2.5 rounded-xl border border-ink-200 bg-white px-3 py-2.5">
              <VerdictBadge verdict={v} size="sm" />
              <span className="text-[13px] leading-snug">{t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* For contractors */}
      <section id="for-contractors" className="scroll-mt-20 bg-[#f2f5f2]">
        <div className="mx-auto grid grid-cols-1 max-w-[1200px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-28">
          <div className="relative overflow-hidden rounded-[18px]">
            <Image src={kitchen} alt="A bright white kitchen with an island" placeholder="blur" sizes="(min-width: 1024px) 560px, 100vw" className="aspect-[1.1] w-full object-cover" />
            <span className="absolute inset-x-5 bottom-5 flex items-center gap-2.5 rounded-xl bg-white/95 px-4 py-3.5 text-sm text-ink-700">
              <Icon name="sparkle" className="h-4 w-4" />
              More thoughtful. More profitable.
            </span>
          </div>
          <div>
            <p className="eyebrow text-[#5f7b6b]">You know the work. Now see the return.</p>
            <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900 sm:text-5xl">
              Good instincts.
              <br />
              Better numbers.
            </h2>
            <p className="mt-6 max-w-lg leading-relaxed text-ink-500">You already know how to bring a house back to life. Renoflip connects your construction know-how with the economics of the deal.</p>
            <ul className="mt-7 divide-y divide-ink-200 border-y border-ink-200">
              {[
                ["Refresh the kitchen", "Keep good cabinets. Update the finish."],
                ["Know where to stop", "Avoid finishes the block won't pay for."],
                ["See every line", "Low, likely and high for each item, plus a reserve for what photos cannot show."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-4 py-4">
                  <Icon name="check" className="mt-0.5 h-5 w-5 text-brand-600" strokeWidth={2.2} />
                  <div>
                    <p className="font-bold text-ink-900">{t}</p>
                    <p className="mt-0.5 text-sm text-ink-500">{d}</p>
                  </div>
                </li>
              ))}
            </ul>
            <a href="#plan" className="btn-primary mt-8">
              Explore the renovation plan
            </a>
          </div>
        </div>
        <div id="plan" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 pb-20 sm:px-8 lg:pb-28">
          <div className="max-w-2xl">
            <h3 className="text-2xl font-bold tracking-tight text-ink-900">Spend where the block pays. Stop where it doesn&apos;t.</h3>
            <p className="mt-3 leading-relaxed text-ink-500">
              {realSales
                ? "Renoflip prices every category against what buyers on this block actually pay for it. What is below par gets brought to par. What is already there is left alone. And when the house already sits near where homes of its size have topped out, the plan tells you to stay at the median finish, before you put $35,000 into a kitchen the sale will not repay. Drag the ceiling in the example and watch the plan change."
                : "Renoflip prices every category against what buyers on this block actually pay for it. What is below par gets brought to par. What is already there is left alone. And when the neighborhood tops out, the plan says so before you put $35,000 into a kitchen the sale will not repay. Drag the ceiling and watch the plan change."}
            </p>
          </div>
          <div className="mt-10">
            <RemodelPlan />
          </div>
          <p className="mt-4 text-xs text-ink-400">
            Sample house: 1,840 sqft, 3 bd / 2 ba, built 1952, dated condition, comps say $845,000 renovated. Unit costs are placeholders at contractor rates until calibrated for your metro.
            {realSales ? " The ceiling in this example is one that caps the plan. For a real house, where public records do not say which homes were renovated, the ceiling is a guide: it sets the finish level the plan advises and takes no line out of it." : ""}
          </p>
        </div>
      </section>

      {/* Try the numbers */}
      <section id="try-the-numbers" className="mx-auto grid grid-cols-1 max-w-[1200px] scroll-mt-20 items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-20 lg:py-28">
        <div>
          <p className="eyebrow text-[#5f7b6b]">A few changes. A clearer decision.</p>
          <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900 sm:text-5xl">
            What if you got
            <br />a better price?
          </h2>
          <p className="mt-6 max-w-md leading-relaxed text-ink-500">Try it. Move the purchase price and watch the profit change. In a real analysis, the homes sold nearby set the resale value and the photos set the work.</p>
          <div className="mt-8 flex max-w-md items-start gap-4 border-t border-ink-200 pt-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eef4e6] text-[#5f7b55]">
              <Icon name="sparkle" className="h-5 w-5" />
            </span>
            <p className="text-sm leading-relaxed text-ink-500">
              Real calculations. Sample numbers.
              <br />
              The same deal math every report runs.
            </p>
          </div>
        </div>
        <DealExplorer cta={{ href: primaryHref, label: signedIn ? "Open your workspace" : "Analyze a real listing" }} />
      </section>

      {/* The ceiling */}
      <section id="ceiling" className="bg-ink-950 text-white">
        <div className="mx-auto grid grid-cols-1 max-w-[1200px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <p className="eyebrow text-lime">The number most calculators skip</p>
            <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em]">Every block has a ceiling. Renoflip finds it.</h2>
            <p className="mt-6 leading-relaxed text-white/75">
              {realSales
                ? "Public records do not say which homes were renovated. So we take the sold homes of similar size found around the house, in its zip code, over the last year and find the price per square foot the dearest tenth of them cleared. When the resale value lands close to that, the report tells you not to put a $60k kitchen in a house that will not pay for it. And when the homes sold right around the house went for more, it says the ceiling is not known instead of guessing."
                : "We take every renovated sale in the neighborhood over the last year and find the price per square foot the top decile clears. If the comp math says $700k but the block has never cleared $640k, the report says $640k, and tells you not to put a $60k kitchen in a house that will not pay for it."}
            </p>
          </div>
          <div className="rounded-[18px] border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>{realSales ? "An example: sold homes of similar size, $/sqft, last 12 months" : "Renovated sales, $/sqft, last 12 months"}</span>
              <span>n = 43</span>
            </div>
            <div className="mt-4 space-y-2.5">
              {(realSales
                ? [["Ceiling (the dearest tenth)", 100, "bg-lime", "$640k"], ["Resale value from the comps", 92, "bg-white/40", "$590k"], ["Median sale", 88, "bg-white/25", "$565k"], ["This house, as-is", 78, "bg-white/15", "$500k"]]
                : [["Comp-based ARV", 108, "bg-white/40", "$700k"], ["Ceiling (top decile)", 100, "bg-lime", "$640k"], ["Median renovated", 88, "bg-white/25", "$565k"], ["This house, as-is", 78, "bg-white/15", "$500k"]]
              ).map(([label, w, c, v]) => (
                <div key={label as string}>
                  <div className="flex justify-between text-xs">
                    <span className="text-white/80">{label}</span>
                    <span className="tabular text-white/60">{v}</span>
                  </div>
                  <div className="mt-1 h-2.5 rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${c}`} style={{ width: `${Math.min(100, (w as number) * 0.9)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-relaxed text-white/70">
              {realSales
                ? "The comps say $590k and the dearest tenth of the sold homes nearby went for $640k: room for a mid-grade finish, not a luxury one, and the plan's advice follows that. Had the comps come in above $640k, the report would say the ceiling is not known."
                : "The comps say $700k. The block says $640k. The report says $640k, and the remodel plan is sized to it: spend $28k, hit the median finish, sell fast."}
            </p>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 lg:py-24">
        <p className="eyebrow text-[#5f7b6b]">Who it&apos;s for</p>
        <h2 className="mt-4 max-w-2xl text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900">Built for the people who put money into houses</h2>
        <Reveal className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {audiences(realSales).map((a) => (
            <div key={a.t} className="rounded-[16px] border border-ink-200 bg-white p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eef4e6] text-[#5f7b55]">
                <Icon name={a.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-ink-900">{a.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{a.d}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-y border-ink-200 bg-[#f5f7f6]">
        <div className="mx-auto grid grid-cols-1 max-w-[1200px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:py-24">
          <div>
            <p className="eyebrow text-[#5f7b6b]">Pricing</p>
            <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900">One good decision pays for a year.</h2>
            <p className="mt-5 max-w-md leading-relaxed text-ink-500">{realSales ? "No card. Paid plans come later, once the resale estimate has passed its accuracy test and payments are in place." : "No card. Paid plans come later, once real sales data and payments are in place."}</p>
          </div>
          {/* One card, because one plan exists. Paid plans go here when they can be bought, and not before. */}
          <div className="flex flex-col rounded-[18px] bg-ink-950 p-7 text-white shadow-[0_30px_60px_-30px_rgb(21_61_53_/_0.6)]">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-bold">Beta</h3>
              <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-ink-950">The only plan today</span>
            </div>
            <div className="mt-4 text-4xl font-bold tracking-tight">
              Free <span className="text-sm font-normal text-white/60">during beta</span>
            </div>
            <p className="mt-2 text-sm text-white/75">Everything Renoflip does today, while it is being built.</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Photo reading of your listing photos, room by room",
                realSales ? "Remodel plan, deal math and stress test, on real sold prices wherever a house can be looked up (marked UNTESTED)" : "Remodel plan, deal math and stress test, on demo sales data for now",
                "Saved deals",
                `${monthlyAnalyses} analyses a month per person`,
              ].map((i) => (
                <li key={i} className="flex gap-2.5">
                  <Icon name="check" className="mt-0.5 h-4 w-4 text-lime" strokeWidth={2.4} />
                  {i}
                </li>
              ))}
            </ul>
            <Link href={primaryHref} className="btn-lime mt-7">
              {primaryLabel}
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto grid grid-cols-1 max-w-[1200px] scroll-mt-20 gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:py-24">
        <div>
          <p className="eyebrow text-[#5f7b6b]">Know what you&apos;re looking at</p>
          <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900">
            Clear assumptions.
            <br />
            Clear boundaries.
          </h2>
        </div>
        <div className="divide-y divide-ink-200 border-y border-ink-200">
          {faq(realSales).map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                {f.q}
                <Icon name="plus" className="h-5 w-5 text-ink-400 transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-3 leading-relaxed text-ink-500">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1200px] px-5 pb-20 sm:px-8 lg:pb-24">
        <div className="flex flex-wrap items-center justify-between gap-8 rounded-[20px] bg-[#e8f0dd] px-7 py-12 sm:px-14 sm:py-14">
          <div>
            <p className="eyebrow text-[#5f7b55]">Build your next move.</p>
            <h2 className="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink-900 sm:text-5xl">
              The right work.
              <br />
              The right investment.
            </h2>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-ink-500">About a minute per house.</p>
            <Link href={primaryHref} className="btn-primary mt-4 px-6 py-3.5 text-[15px]">
              {signedIn ? "Explore your workspace" : "Get started free"}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-200">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-6 px-5 py-10 text-sm text-ink-500 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Logo size="sm" />
            <span>Know the potential. Build with confidence.</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-6">
            <a href="#how-it-works" className="hover:text-ink-950">How it works</a>
            <a href="#pricing" className="hover:text-ink-950">Pricing</a>
            <a href="#faq" className="hover:text-ink-950">FAQ</a>
            <Link href="/sign-in" className="hover:text-ink-950">Sign in</Link>
          </nav>
          <p className="w-full text-xs text-ink-400">Reports are estimates, not appraisals. Verify before you close.</p>
        </div>
      </footer>
    </div>
  );
}
