import Image from "next/image";
import { PHOTOS } from "./photos";

/** The photo assessment, shown on real rooms. Illustrative calls and costs. */
const ROOMS = [
  {
    photo: PHOTOS.kitchen,
    alt: "White kitchen with an island, stone counters and pendant lights",
    room: "Kitchen",
    call: "KEEP",
    callClass: "bg-ink-950 text-white",
    finding: "Renovated within five years: stone counters, new cabinets, a layout that works. Do not touch it.",
    delta: "Saves $29,100 against a full replace",
  },
  {
    photo: PHOTOS.bathroom,
    alt: "Gray tiled bathroom with a freestanding tub",
    room: "Primary bath",
    call: "REFRESH",
    callClass: "bg-brand-100 text-brand-700",
    finding: "Tile and tub are current. Regrout, replace the vanity top and the fixtures, and move on.",
    delta: "+$3,800 · 4 days",
  },
  {
    photo: PHOTOS.livingRoom,
    alt: "Bright living room with a gray sofa and an open staircase",
    room: "Living room",
    call: "KEEP",
    callClass: "bg-ink-950 text-white",
    finding: "Floors refinished, windows newer, plenty of light. Paint and hardware only.",
    delta: "+$1,900",
  },
];

export function PhotoRead() {
  return (
    <section className="border-y border-ink-200/70 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">From the photos</div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Every room, read the way an inspector would.</h2>
          <p className="mt-4 leading-relaxed text-ink-700">
            flip scores each room from the listing photos and makes a call: keep, refresh, replace or required. What is already done is left alone, so the remodel budget goes where the block will pay for it.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {ROOMS.map((r) => (
            <article key={r.room} className="group overflow-hidden rounded-2xl border border-ink-200 bg-canvas">
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={r.photo}
                  alt={r.alt}
                  fill
                  placeholder="blur"
                  sizes="(min-width: 1024px) 360px, (min-width: 768px) 33vw, 100vw"
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                />
                <span className={`absolute left-3 top-3 rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide shadow-sm ${r.callClass}`}>{r.call}</span>
              </div>
              <div className="p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold">{r.room}</h3>
                  <span className="text-xs font-medium tabular-nums text-brand-700">{r.delta}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{r.finding}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-6 text-xs text-ink-500">Illustrative rooms and costs. Photos are analyzed for the report and not used for anything else.</p>
      </div>
    </section>
  );
}
