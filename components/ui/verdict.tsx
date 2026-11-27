import type { Verdict } from "@/lib/engine/types";

const STYLE: Record<Verdict, string> = {
  GO: "bg-go text-white",
  TIGHT: "bg-tight text-white",
  PASS: "bg-pass text-white",
  // Not one of the three colours: it is none of the three yet.
  "CHECK FIRST": "bg-ink-700 text-white",
};

const SIZE = {
  lg: { verdict: "px-4 py-2 text-2xl", mark: "px-2.5 text-xs" },
  md: { verdict: "px-3 py-1 text-sm", mark: "px-2 text-[10px]" },
  sm: { verdict: "px-2 py-0.5 text-xs", mark: "px-1.5 text-[9px]" },
};

const MARK = {
  demo: { word: "Demo", title: "Made-up sales data, not a real valuation", tone: "text-amber-300" },
  untested: { word: "Untested", title: "Real sold prices, worked out by a method that has not been accuracy-tested for this area yet", tone: "text-sky-300" },
};

/**
 * The verdict. With `demo` or `untested`, that word is part of the badge
 * itself: a verdict worked out from made-up sales, or from real ones by a
 * method nobody has tested here yet, must never be readable as a proven
 * one, however it is cropped, copied or screenshotted.
 */
export function VerdictBadge({ verdict, size = "md", demo = false, untested = false }: { verdict: Verdict; size?: "sm" | "md" | "lg"; demo?: boolean; untested?: boolean }) {
  const sz = SIZE[size];
  const mark = demo ? MARK.demo : untested ? MARK.untested : null;
  // A saved deal's verdict is a string from the database: one this version does not know is shown in the neutral colour.
  const colour = STYLE[verdict] ?? STYLE["CHECK FIRST"];
  if (!mark) return <span className={`inline-block whitespace-nowrap rounded-lg font-bold tracking-wide ${sz.verdict} ${colour}`}>{verdict}</span>;
  return (
    <span {...(demo ? { "data-demo-verdict": "" } : { "data-untested-verdict": "" })} title={mark.title} className="inline-flex items-stretch overflow-hidden whitespace-nowrap rounded-lg font-bold tracking-wide">
      <span className={`flex items-center bg-[#0e2a24] uppercase tracking-wider ${mark.tone} ${sz.mark}`}>{mark.word}</span>
      <span className={`${sz.verdict} ${colour}`}>{verdict}</span>
    </span>
  );
}

/** What each verdict means, in a few words, beside it on the result's card. */
export const VERDICT_MEANS: Record<Verdict, string> = {
  GO: "Worth a closer look",
  TIGHT: "A thin margin",
  PASS: "Not at this price",
  "CHECK FIRST": "Check before you offer",
};

const ON_GREEN: Record<Verdict, string> = {
  GO: "bg-lime text-ink-950",
  TIGHT: "bg-[#f6d9a8] text-[#5c3c07]",
  PASS: "bg-[#f4c7c2] text-[#6b1d16]",
  "CHECK FIRST": "bg-white text-ink-950",
};

/**
 * The verdict on the result's dark green card: the verdict and what it means, with DEMO or UNTESTED as part of the
 * same pill, never apart from it (as with VerdictBadge).
 */
export function VerdictPill({ verdict, demo = false, untested = false }: { verdict: Verdict; demo?: boolean; untested?: boolean }) {
  const mark = demo ? MARK.demo : untested ? MARK.untested : null;
  const colour = ON_GREEN[verdict] ?? ON_GREEN["CHECK FIRST"];
  const means = VERDICT_MEANS[verdict] ?? "";
  return (
    <span
      {...(demo ? { "data-demo-verdict": "" } : untested ? { "data-untested-verdict": "" } : {})}
      data-verdict={verdict}
      title={mark?.title}
      className="inline-flex max-w-full items-stretch overflow-hidden rounded-md text-[13px] font-bold"
    >
      {mark && <span className={`flex items-center bg-[#0e2a24] px-2 text-[10px] uppercase tracking-wider ${mark.tone}`}>{mark.word}</span>}
      <span className={`flex items-center gap-1.5 px-2.5 py-1.5 uppercase tracking-wide ${colour}`}>
        {verdict === "GO" ? "✓ " : ""}
        {verdict}
        {means && <span className="font-semibold normal-case tracking-normal opacity-80">· {means}</span>}
      </span>
    </span>
  );
}
