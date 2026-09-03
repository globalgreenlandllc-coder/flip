import Image from "next/image";
import type { Verdict } from "@/lib/engine/types";
import { VerdictBadge } from "@/components/ui/verdict";
import { PHOTOS } from "./photos";
import { money, runSample, signedMoney, type SampleDeal } from "./samples";
import { Reveal } from "./reveal";

/**
 * Five listings, five verdicts: what the product does, at a glance. The
 * photos and inputs are illustrative; the verdicts and numbers come from
 * the engine.
 */
const SAMPLES: { photo: (typeof PHOTOS)[keyof typeof PHOTOS]; alt: string; deal: SampleDeal; arvLabel?: string; note: string }[] = [
  { photo: PHOTOS.craftsman, alt: "Gray craftsman with a stone chimney and wraparound porch", deal: { askingPrice: 565_000, arv: 845_000, rehab: 58_000 }, note: "Comps support it. The rehab is cosmetic." },
  { photo: PHOTOS.brickTwoStory, alt: "Two-story brick house with a double garage", deal: { askingPrice: 1_190_000, arv: 1_050_000, rehab: 40_000 }, arvLabel: "Ceiling", note: "Asking sits above the block's ceiling." },
  { photo: PHOTOS.redRoofCottage, alt: "White cottage with a red metal roof", deal: { askingPrice: 340_000, arv: 505_000, rehab: 42_000 }, note: "Profitable, but short of your target." },
  { photo: PHOTOS.suburbanBrick, alt: "Brick house on a suburban corner lot", deal: { askingPrice: 440_000, arv: 690_000, rehab: 45_000 }, note: "Kitchen and baths carry the spread." },
  { photo: PHOTOS.gambrelSunrise, alt: "Gambrel-roof house at sunrise", deal: { askingPrice: 675_000, arv: 760_000, rehab: 70_000 }, note: "Roof and systems eat the margin." },
];

const PROFIT_TONE: Record<Verdict, string> = { GO: "text-brand-200", TIGHT: "text-amber-200", PASS: "text-red-200" };

export function Showcase() {
  return (
    <section className="border-y border-ink-200/70 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="eyebrow">Any listing, one verdict</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Paste a listing. Get a verdict.</h2>
            <p className="mt-3 leading-relaxed text-ink-700">
              Paste a link. flip pulls the details and photos, prices the finished house against real sales and the block&apos;s ceiling, and tells you whether the money works.
            </p>
          </div>
          <p className="text-xs text-ink-500">Illustrative listings. Verdicts and numbers are computed by the engine.</p>
        </div>

        <Reveal className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {SAMPLES.map((s, i) => {
            const d = runSample(s.deal);
            return (
              <figure
                key={s.alt}
                className={`group relative aspect-[4/5] overflow-hidden rounded-2xl bg-ink-100 ${i === 4 ? "hidden lg:block" : ""} ${i === 3 ? "md:hidden lg:block" : ""}`}
              >
                <Image
                  src={s.photo}
                  alt={s.alt}
                  fill
                  placeholder="blur"
                  sizes="(min-width: 1024px) 220px, (min-width: 768px) 33vw, 50vw"
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/30 to-ink-950/5" />
                <div className="absolute left-3 top-3">
                  <VerdictBadge verdict={d.verdict} size="sm" />
                </div>
                <figcaption className="absolute inset-x-0 bottom-0 p-4 text-white">
                  <div className="text-[11px] text-white/70">
                    Asking <span className="tabular-nums text-white">{money(s.deal.askingPrice)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/70">
                    {s.arvLabel ?? "ARV"} <span className="tabular-nums text-white">{money(s.deal.arv)}</span>
                  </div>
                  <div className={`mt-2 text-xl font-bold tabular-nums tracking-tight ${PROFIT_TONE[d.verdict]}`}>{signedMoney(d.profit)}</div>
                  <p className="mt-1 text-xs leading-snug text-white/80">{s.note}</p>
                </figcaption>
              </figure>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
