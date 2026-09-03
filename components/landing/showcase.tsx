import Image from "next/image";
import type { Verdict } from "@/lib/engine/types";
import { VerdictBadge } from "@/components/ui/verdict";
import { PHOTOS } from "./photos";

/** Five listings, five verdicts: what the product does, at a glance. Illustrative numbers. */
const SAMPLES: {
  photo: (typeof PHOTOS)[keyof typeof PHOTOS];
  alt: string;
  verdict: Verdict;
  asking: string;
  arv: string;
  arvLabel?: string;
  profit: string;
  note: string;
}[] = [
  { photo: PHOTOS.craftsman, alt: "Gray craftsman with a stone chimney and wraparound porch", verdict: "GO", asking: "$612,000", arv: "$845,000", profit: "+$71,200", note: "Comps support it. The rehab is cosmetic." },
  { photo: PHOTOS.brickTwoStory, alt: "Two-story brick house with a double garage", verdict: "PASS", asking: "$1,190,000", arv: "$1,050,000", arvLabel: "Ceiling", profit: "−$38,600", note: "Asking sits above the block's ceiling." },
  { photo: PHOTOS.redRoofCottage, alt: "White cottage with a red metal roof", verdict: "TIGHT", asking: "$389,000", arv: "$505,000", profit: "+$14,800", note: "Works at asking, not at your target." },
  { photo: PHOTOS.suburbanBrick, alt: "Brick house on a suburban corner lot", verdict: "GO", asking: "$498,000", arv: "$690,000", profit: "+$58,900", note: "Kitchen and baths carry the spread." },
  { photo: PHOTOS.gambrelSunrise, alt: "Gambrel-roof house at sunrise", verdict: "PASS", asking: "$675,000", arv: "$760,000", profit: "−$21,400", note: "Roof and systems eat the margin." },
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
          <p className="text-xs text-ink-500">Illustrative listings and numbers.</p>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {SAMPLES.map((s, i) => (
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
                <VerdictBadge verdict={s.verdict} size="sm" />
              </div>
              <figcaption className="absolute inset-x-0 bottom-0 p-4 text-white">
                <div className="flex items-baseline justify-between text-[11px] text-white/70">
                  <span>Asking <span className="tabular-nums text-white">{s.asking}</span></span>
                </div>
                <div className="mt-0.5 text-[11px] text-white/70">
                  {s.arvLabel ?? "ARV"} <span className="tabular-nums text-white">{s.arv}</span>
                </div>
                <div className={`mt-2 text-xl font-bold tabular-nums tracking-tight ${PROFIT_TONE[s.verdict]}`}>{s.profit}</div>
                <p className="mt-1 text-xs leading-snug text-white/80">{s.note}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
