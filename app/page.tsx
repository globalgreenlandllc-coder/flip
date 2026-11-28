import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { limitsFromEnv } from "@/lib/usage/limits";
import { rentcastFromEnv } from "@/lib/data/house-data";
import { Logo } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { VerdictBadge } from "@/components/ui/verdict";
import { BeforeAfter } from "@/components/landing/before-after";
import { SampleDealPanel, SampleDealProvider, StrategyChooser } from "@/components/landing/sample-deal";

/*
 * The landing page in the light edition of the owner's design (2026-11-27). Every claim on it is true of what RenoFlip
 * does today, or is marked: the sample deal as SAMPLE DATA (worked out by RenoFlip's own engine), the concept pictures
 * as AI-made illustrations, the paid plans as coming soon. What the page says about where the numbers come from is what
 * is true of this deployment: with real sold prices connected (lib/data/house-data.ts) it says so and says what has not
 * been tested yet; without, it says the numbers are a demo.
 */

const faq = (realSales: boolean) => [
  { q: "Is this an appraisal?", a: "No. It is a decision tool built the way a good appraiser and a good flipper think: comps with visible adjustments, a ceiling for the neighborhood, and deal math with every assumption on the page. Verify before you close. The sample deal on this page is made up: its house, values and costs are illustrations." },
  { q: "What happens when I change the sample's price?", a: "The buying costs, the loan interest and the profit are worked out again together, by the same engine a report runs. The most you can offer stays where it is: it comes from the resale value, the work and the target, not from the price, and the line on the slider shows where your price sits against it. The sample's resale value and its work stay the same." },
  realSales
    ? { q: "Where do the comps come from?", a: "From county public records of sold homes, read through a data service. Each sale used is shown with its address, its date and its price, so you can check it. When a house cannot be looked up (no address, no record of it, or the month's lookups are used up), the result falls back to made-up demo data and is marked DEMO. The photo reading is always real." }
    : { q: "Where do the comps come from?", a: "In this beta they are demo data: the sales behind the resale numbers are made up, and every number built on them is marked DEMO. Real recorded-sale data is being connected next, one area at a time. The photo reading is real today." },
  realSales
    ? { q: "How accurate is the ARV?", a: "Not measured yet. The sold prices are real, but the method that turns them into a resale value has not been tested against completed flips in any area, and its adjustment rates are placeholders. So a result built on real sold prices is marked UNTESTED and is never a GO: where the numbers alone would say GO, it says CHECK FIRST. Before that changes in an area, the model is tested against completed flips there: it sees only what was known on purchase day, and its ARV is compared with the actual resale. That measured accuracy will be shown beside every ARV." }
    : { q: "How accurate is the ARV?", a: "Not measured yet, because the beta runs on demo sales. Before real numbers are turned on in an area, the model is tested against completed flips there: it sees only what was known on purchase day, and its ARV is compared with the actual resale. That measured accuracy will be shown beside every ARV." },
  realSales
    ? { q: "What is the block's ceiling?", a: "Public records do not say which homes were renovated. So we take the sold homes of similar size found around the house, in its zip code, over the last year and find the price per square foot the dearest tenth of them cleared. When the resale value lands close to that, the report tells you not to put a $60k kitchen in a house that will not pay for it. And when the homes sold right around the house went for more, it says the ceiling is not known instead of guessing. For a real house the ceiling is a guide: it sets the finish level the plan advises and takes no line out of it." }
    : { q: "What is the block's ceiling?", a: "We take every renovated sale in the neighborhood over the last year and find the price per square foot the top decile clears. If the comp math says $700k but the block has never cleared $640k, the report says $640k, and tells you not to put a $60k kitchen in a house that will not pay for it." },
  { q: "What if the listing site blocks the link?", a: "Some portals block automated reads some of the time. When that happens the page says so and you drop the photos in directly, or use the browser button. Everything else works the same." },
  { q: "Are the paid plans on sale?", a: "Not yet. RenoFlip is free during the beta. The plans shown under Pricing are what is planned: they are not on sale, no card is asked for, and how many reports the monthly plan includes is not decided yet." },
  { q: "What else is coming?", a: "Planned: white-label reports for agents, an API for platforms, and a published accuracy number for your metro. On your own house: choosing between renovation levels, your crew's prices and the timeline, as the sample on this page shows." },
  { q: "Who can see my deals?", a: "Only you. Photos are analyzed and not used for anything else, and RenoFlip keeps no listing photos." },
  {
    q: "What does RenoFlip record about visits?",
    a: "When you are signed in, RenoFlip keeps your account with each page you open: the page, the time, the city your internet address is in, the kind of device, the browser or app, and the site or ad that sent you. When you are not signed in, it keeps the same without an account, under a code that changes every day; it never keeps your internet address and sets no cookie. Visits are deleted after about 13 months.",
  },
];

const NAV_LINKS = [
  ["#deal", "Try the numbers"],
  ["#approach", "The approach"],
  ["#pricing", "Pricing"],
  ["#faq", "FAQ"],
] as const;

/** The three plans of the design, not on sale: no price here can be paid, and the monthly allowance is undecided. */
const PLANS = [
  { kicker: "Get to know RenoFlip", name: "Your first full report", price: "$0", per: "one complete report", d: "The whole decision on one house, before choosing a paid plan." },
  { kicker: "Pay as you go", name: "One property", price: "$9", per: "per full report", d: "A complete property analysis when you need one. No monthly commitment." },
  { kicker: "Keep exploring", name: "Ongoing deal search", price: "$39", per: "per month", d: "A monthly plan for comparing your next opportunities. How many reports it includes is not decided yet." },
];
const PLAN_INCLUDES = ["The most you can offer for a profit target", "Renovation plan read from the photos", "Profit, margin and the downside"];

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="mx-auto max-w-[1280px] px-4 sm:px-7">
      <div className="flex h-[86px] items-center justify-between gap-3 border-b border-[#dfe3e8] sm:gap-6">
        {/* Wrapped: the logo's own inline-flex would win over a hidden put on it. */}
        <span className="sm:hidden">
          <Logo size="sm" />
        </span>
        <span className="hidden sm:inline-flex">
          <Logo />
        </span>
        <nav aria-label="On this page" className="hidden items-center gap-6 text-sm text-[#545b68] lg:flex">
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-[#141820]">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {signedIn ? (
            <Link href="/app" className="btn-primary px-4 sm:px-5">
              <span className="sm:hidden">Workspace</span>
              <span className="hidden sm:inline">Open workspace</span>
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="hidden text-sm font-semibold text-[#3d4452] transition-colors hover:text-[#141820] sm:block">
                Sign in
              </Link>
              <Link href="/sign-up" className="btn-primary px-3.5 sm:px-5">
                Get started
              </Link>
            </>
          )}
          <details className="mnav relative lg:hidden">
            <summary className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[9px] border border-[#dfe3e8] bg-white text-[#141820]" aria-label="Menu">
              <Icon name="menu" className="mnav-open h-5 w-5" />
              <Icon name="close" className="mnav-close h-5 w-5" />
            </summary>
            <nav className="absolute right-0 top-13 z-30 w-60 rounded-[12px] border border-[#dfe3e8] bg-white p-2 text-[15px] text-[#141820] shadow-[0_24px_60px_-24px_rgb(20_24_32_/_0.35)]">
              {NAV_LINKS.map(([href, label]) => (
                <a key={href} href={href} className="block rounded-[8px] px-3 py-2.5 hover:bg-[#f1f3f6]">
                  {label}
                </a>
              ))}
              {!signedIn && (
                <Link href="/sign-in" className="block rounded-[8px] px-3 py-2.5 hover:bg-[#f1f3f6] sm:hidden">
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

/** The light edition's small capitalised line: grey, spaced out. */
function Eyebrow({ children, tone = "text-[#5d6574]", center = false }: { children: React.ReactNode; tone?: string; center?: boolean }) {
  return <p className={`text-xs font-bold uppercase tracking-[0.16em] ${tone} ${center ? "text-center" : ""}`}>{children}</p>;
}

function H2({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-[40px] font-semibold leading-[1.08] tracking-[-0.055em] text-[#141820] sm:text-[52px] ${className}`}>{children}</h2>;
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

  return (
    <div className="flex-1 bg-[#f7f8fa] text-[#141820]">
      <Nav signedIn={signedIn} />

      <main>
        <SampleDealProvider>
          {/* Hero: centred, as the light edition */}
          <section className="mx-auto max-w-[1280px] px-4 pt-8 sm:px-7">
            <div className="mx-auto max-w-[860px] text-center">
              <Eyebrow center>A clearer way to look at a flip</Eyebrow>
              <h1 className="fade-up mt-4 text-[44px] font-bold leading-[1.04] tracking-[-0.065em] sm:text-[64px] lg:text-[clamp(64px,6.05vw,86px)]" data-hero-title>
                <span className="block lg:whitespace-nowrap">Know what to pay.</span>
                <span className="block text-[#7a818d] lg:whitespace-nowrap">See what you keep.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-[605px] text-[17px] leading-relaxed text-[#596170]">Your maximum buy price, a clear financial fit, and net profit after project costs, with a renovation plan read from the listing&apos;s photos.</p>
              {/* A real way in: the link goes to the analysis form, filled in; nothing is read until the button there is pressed. */}
              <form action="/app/analyze" method="get" className="mx-auto mt-9 max-w-[690px] text-left" data-hero-link>
                <label htmlFor="hero-link" className="block text-sm font-semibold text-[#2a303b]">
                  Start with a property listing link
                </label>
                <div className="mt-3 grid grid-cols-1 gap-2 rounded-[10px] border border-[#d5dae1] bg-white p-1.5 sm:grid-cols-[1fr_auto]">
                  <input id="hero-link" name="link" type="url" required inputMode="url" placeholder="Paste a Zillow, Redfin or Realtor.com link" className="min-w-0 bg-transparent px-3.5 py-3 text-[15px] text-[#141820] outline-none placeholder:text-[#7b8290]" />
                  <button type="submit" className="btn-accent">
                    Analyze this listing
                  </button>
                </div>
                <Link href="/app/find" className="mt-4 inline-block border-b border-[#a9afb8] pb-1 text-sm text-[#2a303b] hover:border-[#141820]">
                  Browse homes for sale by ZIP
                </Link>
                <p className="mt-3 text-xs leading-relaxed text-[#626a77]">{signedIn ? "It opens the analysis with the link filled in; add the photos and press Analyze." : "Sign in or create an account; the analysis then opens with the link filled in. Add the photos and press Analyze."}</p>
              </form>
              <div className="mt-6 flex items-center justify-center gap-6 text-sm font-semibold">
                <a href="#deal" className="border-b border-[#a9afb8] py-2 hover:border-[#141820]">
                  Try the numbers
                </a>
                <a href="#approach" className="border-b border-[#a9afb8] py-2 hover:border-[#141820]">
                  See the approach
                </a>
              </div>
              <p className="mx-auto mt-6 max-w-[640px] text-xs leading-relaxed text-[#626a77]">
                {realSales
                  ? "No card. Free during beta. About a minute per house. The photo reading and the sold prices are real. The resale estimate built on them has not been accuracy-tested yet, so a result built on real sold prices is marked UNTESTED and is never a GO: where the numbers alone would say GO, it says CHECK FIRST. A house that cannot be looked up gets made-up demo numbers, marked DEMO."
                  : "No card. Free during beta. About a minute per house. In the beta the photo reading is real; the sales behind the resale numbers are demo data, and every number built on them is marked DEMO."}
              </p>
            </div>
            <div className="mt-10">
              <SampleDealPanel cta={{ href: primaryHref, label: "Analyze a real listing" }} />
            </div>
          </section>

          {/* The work behind the numbers: the design's before-and-after, its AI-made pictures marked as such */}
          <section className="mx-auto mt-24 max-w-[1280px] border-t border-[#dfe3e8] px-4 pt-20 sm:px-7">
            <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <div>
                <Eyebrow>See the work behind the numbers</Eyebrow>
                <H2 className="mt-4">
                  A clearer plan.
                  <br />A visible transformation.
                </H2>
              </div>
              <p className="max-w-md leading-relaxed text-[#596170] lg:justify-self-end">Explore a kitchen and an exterior concept, each tied to a sample budget. The pictures are illustrations of the idea.</p>
            </div>
            <BeforeAfter />
          </section>

          {/* The approach: more renovation or more return, on the sample */}
          <section id="approach" className="mx-auto mt-24 max-w-[1280px] scroll-mt-6 border-t border-[#dfe3e8] px-4 pt-20 sm:px-7">
            <StrategyChooser />
          </section>
        </SampleDealProvider>

        {/* The reasoning, and what each verdict means */}
        <section className="mx-auto mt-24 max-w-[1280px] border-t border-[#dfe3e8] px-4 pt-20 sm:px-7">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div>
              <Eyebrow>The value is in the reasoning</Eyebrow>
              <H2 className="mt-4">
                See what changes
                <br />
                the decision.
              </H2>
            </div>
            <div className="space-y-5 text-[15px] leading-relaxed text-[#596170]">
              <p>
                <strong className="text-[#141820]">Make the offer defensible.</strong> The most you can offer comes from the same purchase, renovation, loan and selling-cost math as the profit.
              </p>
              <p>
                <strong className="text-[#141820]">Keep the unknowns visible.</strong> A good financial result does not check the house. Made-up numbers stay marked DEMO, and a favorable result on an untested estimate says CHECK FIRST.
              </p>
              <p>
                <strong className="text-[#141820]">Test the difficult combination.</strong> Every report tries a lower resale price with more renovation (resale −10%, work +20%), which can turn an attractive margin into a loss. What one more month costs is shown in the sample above.
              </p>
            </div>
          </div>
          {/* With real sold prices connected, CHECK FIRST stands where a GO would, until an area's accuracy test is passed. */}
          <div className="mt-12 grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2 lg:grid-cols-4" data-verdict-key>
            {(
              [
                ["GO", "the money works, even at ARV −10%"],
                ["TIGHT", "short of the target, or fails the downside test"],
                ["PASS", "you would lose money"],
                ...(realSales ? ([["CHECK FIRST", "the numbers work; the estimate is not proven here yet"]] as const) : []),
              ] as const
            ).map(([v, t]) => (
              <div key={v} className="flex items-center gap-2.5 rounded-[10px] border border-[#dfe3e8] bg-white px-3 py-2.5">
                <VerdictBadge verdict={v} size="sm" />
                <span className="text-[13px] leading-snug text-[#3d4452]">{t}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing: what is true today first, then the plans that are coming */}
        <section id="pricing" className="mx-auto mt-24 max-w-[1280px] scroll-mt-6 border-t border-[#dfe3e8] px-4 pt-20 sm:px-7">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow center>Start with one good decision</Eyebrow>
            <H2 className="mt-4">Free while RenoFlip is in beta.</H2>
            <p className="mt-4 leading-relaxed text-[#596170]">{realSales ? "No card. Paid plans come later, once the resale estimate has passed its accuracy test and payments are in place." : "No card. Paid plans come later, once real sales data and payments are in place."}</p>
          </div>
          <div className="mt-12 rounded-[16px] border border-orange bg-white p-7 sm:p-8" data-beta-plan>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.3fr] lg:items-center">
              <div>
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-lg font-bold">Beta</h3>
                  <span className="rounded-full bg-orange px-2.5 py-0.5 text-[11px] font-bold text-[#111416]">The only plan today</span>
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-tight">
                  Free <span className="text-sm font-normal text-[#596170]">during beta</span>
                </div>
                <p className="mt-2 text-sm text-[#596170]">Everything RenoFlip does today, while it is being built.</p>
                <Link href={primaryHref} className="btn-accent mt-6">
                  {primaryLabel}
                </Link>
              </div>
              <ul className="space-y-2.5 text-sm text-[#2a303b]">
                {[
                  "Photo reading of your listing photos, room by room",
                  realSales ? "Remodel plan, deal math and stress test, on real sold prices wherever a house can be looked up (marked UNTESTED)" : "Remodel plan, deal math and stress test, on demo sales data for now",
                  "Saved deals",
                  `${monthlyAnalyses} analyses a month per person`,
                ].map((i) => (
                  <li key={i} className="flex gap-2.5">
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#d84a22]" strokeWidth={2.4} />
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">The plans to come</h3>
            <p className="text-sm text-[#596170]">Planned, not on sale: nothing here can be bought yet, and no card is asked for.</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3" data-coming-plans>
            {PLANS.map((p) => (
              <div key={p.name} className="flex flex-col rounded-[16px] border border-[#dfe3e8] bg-white p-6" data-coming-plan>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5d6574]">{p.kicker}</p>
                  <span className="rounded-[4px] border border-[#e9b9a6] bg-[#fff4ef] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#b9411d]">Coming soon</span>
                </div>
                <h4 className="mt-4 text-lg font-bold">{p.name}</h4>
                <p className="mt-3">
                  <span className="text-4xl font-semibold tracking-tight">{p.price}</span> <span className="text-sm text-[#596170]">{p.per}</span>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[#596170]">{p.d}</p>
                <ul className="mt-5 space-y-2 border-t border-[#edf0f4] pt-5 text-sm text-[#2a303b]">
                  {PLAN_INCLUDES.map((i) => (
                    <li key={i} className="flex gap-2.5">
                      <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#d84a22]" strokeWidth={2.4} />
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto mt-24 grid max-w-[1280px] scroll-mt-6 grid-cols-1 gap-10 border-t border-[#dfe3e8] px-4 pb-24 pt-20 sm:px-7 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Eyebrow>A few clear answers</Eyebrow>
            <H2 className="mt-4">
              Before you
              <br />
              start exploring.
            </H2>
          </div>
          <div className="divide-y divide-[#dfe3e8] border-y border-[#dfe3e8]">
            {faq(realSales).map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Icon name="plus" className="h-5 w-5 shrink-0 text-[#7b8290] transition-transform group-open:rotate-45" />
                </summary>
                <p className="mt-3 leading-relaxed text-[#596170]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing band */}
        <section className="bg-[#eceef2]">
          <div className="mx-auto max-w-[1280px] px-4 py-20 text-center sm:px-7 sm:py-24">
            <Eyebrow center>Make room for a better decision</Eyebrow>
            <p className="mt-5 text-[52px] font-bold leading-none tracking-[-0.065em] sm:text-[80px]">Know the deal.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href={primaryHref} className="btn-accent px-6 py-3.5 text-[15px]">
                {signedIn ? "Open your workspace" : "Get started free"}
              </Link>
              <a href="#deal" className="btn-secondary">
                Try the sample numbers
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1280px] px-4 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-6 py-10 text-sm text-[#596170]">
          <Logo size="sm" />
          <span>Reports are estimates, not appraisals. Verify before you close.</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-6">
            <a href="#pricing" className="hover:text-[#141820]">Pricing</a>
            <a href="#faq" className="hover:text-[#141820]">FAQ</a>
            <Link href="/sign-in" className="hover:text-[#141820]">Sign in</Link>
          </nav>
          <p className="w-full text-xs text-[#626a77]">Pictures marked as concepts are AI-made illustrations, not real houses. The sample deal is made up.</p>
        </div>
      </footer>
    </div>
  );
}
