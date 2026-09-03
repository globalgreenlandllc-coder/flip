import Image from "next/image";
import { VerdictBadge } from "@/components/ui/verdict";
import { PHOTOS } from "./photos";
import { HERO_DEAL, money, runSample } from "./samples";

/**
 * The hero visual: a real listing photo with flip's read laid over it
 * (verdict, photo callouts, asking vs. max offer), then the numbers that
 * decided it. The deal numbers come from the engine (see samples.ts); the
 * photo callouts and remodel lines are illustrative.
 */

const CALLOUTS: { label: string; note: string; tone: "keep" | "refresh"; left: string; top: string; delay: number }[] = [
  { label: "Roof", note: "2016 · keep", tone: "keep", left: "40%", top: "23%", delay: 600 },
  { label: "Exterior", note: "paint only · +$4,200", tone: "refresh", left: "6%", top: "47%", delay: 900 },
  { label: "Porch", note: "structure sound", tone: "keep", left: "58%", top: "70%", delay: 1200 },
];

const REMODEL: [string, string, string, string][] = [
  ["REPLACE", "Kitchen", "+$29,100", "bg-brand-100 text-brand-700"],
  ["REFRESH", "Flooring", "+$18,300", "bg-brand-50 text-brand-700"],
  ["REQUIRED", "Plumbing", "$0", "bg-red-100 text-red-800"],
  ["SKIP", "Windows", "won't come back", "bg-ink-100 text-ink-500"],
];

function Corner({ className }: { className: string }) {
  return <span aria-hidden className={`absolute h-5 w-5 border-white/70 ${className}`} />;
}

export function HeroCard() {
  const d = runSample(HERO_DEAL);
  return (
    <div className="fade-up relative" style={{ animationDelay: "180ms" }}>
      <div
        aria-hidden
        className="absolute -inset-8 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_30%_20%,rgb(16_185_129/0.22),transparent_70%),radial-gradient(50%_50%_at_90%_90%,rgb(217_119_6/0.14),transparent_70%)] blur-2xl"
      />
      <div className="overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-[0_50px_100px_-40px_rgb(11_18_32/0.5)]">
        <div className="relative aspect-[3/2]">
          <Image
            src={PHOTOS.bungalow}
            alt="A white and cedar craftsman bungalow with a deep front porch, the sample listing flip is reading"
            fill
            preload
            placeholder="blur"
            sizes="(min-width: 1024px) 600px, 100vw"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/70 via-ink-950/5 to-ink-950/20" />

          {/* reading frame */}
          <Corner className="left-4 top-4 rounded-tl-lg border-l-2 border-t-2" />
          <Corner className="right-4 top-4 rounded-tr-lg border-r-2 border-t-2" />
          <Corner className="bottom-4 left-4 rounded-bl-lg border-b-2 border-l-2" />
          <Corner className="bottom-4 right-4 rounded-br-lg border-b-2 border-r-2" />
          <div aria-hidden className="scan-line absolute inset-x-6 h-px bg-gradient-to-r from-transparent via-brand-200 to-transparent shadow-[0_0_12px_rgb(167_243_208/0.9)]" />

          <div className="absolute left-7 top-7 rounded-full bg-ink-950/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
            Sample listing · 1,840 sqft · 3 bd / 2 ba · built 1952
          </div>
          <div className="pop-in absolute right-7 top-6" style={{ animationDelay: "1500ms" }}>
            <span className="inline-block rounded-xl bg-white/15 p-1 backdrop-blur">
              <VerdictBadge verdict={d.verdict} size="lg" />
            </span>
          </div>

          {CALLOUTS.map((c) => (
            <div
              key={c.label}
              className="pop-in absolute flex items-center gap-2 rounded-full bg-white/95 py-1 pl-1.5 pr-3 text-[11px] font-medium text-ink-900 shadow-lg shadow-ink-950/20 backdrop-blur"
              style={{ left: c.left, top: c.top, animationDelay: `${c.delay}ms` }}
            >
              <span className={`h-2.5 w-2.5 rounded-full ring-4 ${c.tone === "keep" ? "bg-brand-500 ring-brand-500/25" : "bg-tight ring-tight/25"}`} />
              <span className="font-semibold">{c.label}</span>
              <span className="text-ink-500">{c.note}</span>
            </div>
          ))}

          <div className="absolute inset-x-7 bottom-6 flex items-end justify-between text-white">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Asking</div>
              <div className="text-2xl font-bold tabular-nums tracking-tight">{money(d.purchasePrice)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Your max offer</div>
              <div className="text-2xl font-bold tabular-nums tracking-tight text-brand-200">{money(d.maxAllowableOffer)}</div>
            </div>
          </div>
        </div>

        <div className="p-5">
          <p className="text-sm leading-relaxed text-ink-700">
            <span className="font-semibold text-ink-950">Asking is {money(d.askingVsMao)} under your max offer</span> and the deal survives ARV −10% with rehab +20%.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2.5 text-sm">
            {[["ARV", money(d.arv)], ["Rehab + reserve", money(d.rehabWithReserve)], ["Profit", money(d.profit)]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-ink-100/70 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{k}</div>
                <div className="mt-0.5 font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-ink-500">
              <span>ARV vs. neighborhood ceiling</span>
              <span className="tabular-nums">96%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full w-[96%] rounded-full bg-gradient-to-r from-brand-500 to-brand-600" />
            </div>
            <p className="mt-1.5 text-xs text-ink-500">Within 4% of the ceiling. Premium finishes will not be repaid here.</p>
          </div>
          <div className="mt-4 space-y-1.5 text-sm">
            {REMODEL.map(([a, i, n, c]) => (
              <div key={i} className="flex items-center gap-3">
                <span className={`w-[4.5rem] rounded px-1.5 py-0.5 text-center text-[10px] font-semibold ${c}`}>{a}</span>
                <span className="flex-1">{i}</span>
                <span className="tabular-nums text-ink-700">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
