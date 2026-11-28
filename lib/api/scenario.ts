/**
 * A saved Deal Studio scenario (2026-11-28): the person's own inputs for one deal, kept inside the deal's payload
 * (DealPayload.scenario) — no new column, no new table. One scenario per deal for now (the owner's decision): saving
 * again replaces it, and saving the analysis' own inputs removes it.
 *
 * Version 1 (Studio part 1) kept the price, timeline, target and assumptions. Version 2 (the advisor, part 2) adds the
 * renovation scope: each line's option, costs typed by hand, the crew discount, and where the resale comes from. A
 * version 1 scenario still opens (on the analysis' scope).
 *
 * What is kept is what the person chose (the inputs) and the numbers the SERVER worked out from them with the same
 * engine; numbers sent by a browser are never stored (an estimated resale is worked out again here; a resale the
 * person typed or kept is theirs, held to a range). The deal's own columns (verdict, resale, maximum offer, profit,
 * provider) stay the analysis', so the list of deals keeps showing what was analysed.
 */
import { z } from "zod";
import type { CostBelowTypical, Report, Verdict } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import { DEFAULT_RENOVATION_COSTS, type CategoryKey } from "@/lib/engine/renovation";
import { STUDIO_BOUNDS, STUDIO_KEYS, clampInputs, liveNumbers, liveReport, sameInputs, studioBase, type StudioInputs } from "@/lib/engine/studio";
import { ADVISOR_BOUNDS, advisorBase, advisorLive, cleanAdvisor, defaultAdvisor, estimateFor, sameAdvisor, scopeNotes, type AdvisorBase, type AdvisorState, type ResaleBasis } from "@/lib/engine/advisor";

export interface ScenarioSnapshot {
  verdict: Verdict;
  profit: number;
  maxOffer: number;
  margin: number | null;
  roiOnCost: number | null;
  cashNeeded: number;
  downside: number;
  /** Version 2: the renovation (before the reserve) and the resale the numbers were worked on. */
  rehab?: number;
  resale?: number;
  /** Version 2: the lines priced below the typical range for the work, when the numbers rest on any. */
  belowTypical?: CostBelowTypical[];
}

/** The advisor's part of a scenario, as stored. */
export interface StoredAdvisor {
  choices: { key: CategoryKey; option: "skip" | "refresh" | "replace" }[];
  costs: { key: CategoryKey; action: "refresh" | "replace" | "required" | "inspect"; cost: number }[];
  crewPct: number;
  resale: { basis: ResaleBasis; value: number };
  reviewOpen: boolean;
}

export interface StoredScenario {
  v: 1 | 2;
  inputs: StudioInputs;
  /** Version 2 only, when the scope or the resale differs from the analysis'. */
  advisor?: StoredAdvisor;
  /** Worked out on the server when it was saved. */
  snapshot: ScenarioSnapshot;
  /** ISO time it was saved. */
  savedAt: string;
}

const field = (k: keyof StudioInputs) =>
  z.number({ error: `${k} must be a number.` }).finite({ error: `${k} must be a number.` }).min(STUDIO_BOUNDS[k].min, { error: `${k} is out of range.` }).max(STUDIO_BOUNDS[k].max, { error: `${k} is out of range.` });

export const scenarioInputs = z.strictObject(Object.fromEntries(STUDIO_KEYS.map((k) => [k, field(k)])) as Record<keyof StudioInputs, z.ZodNumber>);

const KEYS = Object.keys(DEFAULT_RENOVATION_COSTS) as [CategoryKey, ...CategoryKey[]];
const bounded = (b: { min: number; max: number }) => z.number().finite().min(b.min).max(b.max);

export const advisorInput = z.strictObject({
  choices: z.array(z.strictObject({ key: z.enum(KEYS), option: z.enum(["skip", "refresh", "replace"]) })).max(KEYS.length),
  costs: z.array(z.strictObject({ key: z.enum(KEYS), action: z.enum(["refresh", "replace", "required", "inspect"]), cost: bounded(ADVISOR_BOUNDS.cost) })).max(KEYS.length * 2),
  crewPct: bounded(ADVISOR_BOUNDS.crewPct),
  resale: z.strictObject({ basis: z.enum(["analysis", "estimate", "kept", "mine"]), value: bounded({ min: 0, max: ADVISOR_BOUNDS.resale.max }) }),
  reviewOpen: z.boolean(),
});

/** What the browser sends: version 1's inputs alone, or version 2's inputs with the advisor's state. */
const scenarioV2 = z.strictObject({ inputs: scenarioInputs, advisor: advisorInput.optional() });

export type ScenarioResult = { ok: true; scenario: StoredScenario | null } | { ok: false; error: string };

/** The advisor state from what was stored or sent. */
export function advisorFromStored(s: z.infer<typeof advisorInput>): AdvisorState {
  return { choices: Object.fromEntries(s.choices.map((c) => [c.key, c.option])), costs: s.costs, crewPct: s.crewPct, resale: s.resale, reviewOpen: s.reviewOpen };
}

/** The advisor state as stored (the estimate's value as worked out here). */
function toStored(base: AdvisorBase, s: AdvisorState): StoredAdvisor {
  return {
    choices: Object.entries(s.choices).map(([key, option]) => ({ key: key as CategoryKey, option: option! })),
    costs: s.costs.map((c) => ({ key: c.key, action: c.action as StoredAdvisor["costs"][number]["action"], cost: c.cost })),
    crewPct: s.crewPct,
    resale: s.resale.basis === "estimate" ? { basis: "estimate", value: estimateFor(base, s.choices) } : s.resale,
    reviewOpen: s.reviewOpen,
  };
}

/**
 * The scenario to keep with a deal, from the deal's own report and plan and the person's inputs; null when the inputs
 * are the analysis' own (nothing to keep). An error, in words, when the inputs are not numbers in range or the deal
 * cannot be worked again (saved before Deal Studio kept its terms, or a plan saved before the advisor).
 */
export function scenarioFor(report: Report, raw: unknown, opts: { demo: boolean; now: Date; plan?: RenovationPlan | null }): ScenarioResult {
  // Version 1 sends the inputs alone; version 2 sends { inputs, advisor }.
  const isV2 = !!raw && typeof raw === "object" && "inputs" in (raw as object);
  const parsed = isV2 ? scenarioV2.safeParse(raw) : scenarioInputs.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Those numbers could not be read. Check the fields and try again." };
  const rawInputs = (isV2 ? (parsed.data as z.infer<typeof scenarioV2>).inputs : parsed.data) as StudioInputs;
  const rawAdvisor = isV2 ? (parsed.data as z.infer<typeof scenarioV2>).advisor : undefined;
  const base = studioBase(report);
  if (!base.editable) return { ok: false, error: "This deal was saved before RenoFlip kept its assumptions, so it can only be shown as it was analyzed." };
  const inputs = clampInputs(rawInputs);

  if (rawAdvisor) {
    const ab = advisorBase(report, opts.plan, base);
    if (!ab.ok) return { ok: false, error: "This deal's renovation plan was saved before it could be changed, so only the price, the timeline and the assumptions can be kept." };
    const state = cleanAdvisor(ab.base, advisorFromStored(rawAdvisor));
    // The estimate is worked out here, never taken from the browser.
    const held: AdvisorState = state.resale.basis === "estimate" ? { ...state, resale: { basis: "estimate", value: estimateFor(ab.base, state.choices) } } : state;
    if (sameInputs(inputs, base.inputs) && sameAdvisor(ab.base, held, defaultAdvisor(ab.base))) return { ok: true, scenario: null };
    const a = advisorLive(ab.base, inputs, held, report.deal.purchasePrice);
    const sameScope = sameAdvisor(ab.base, held, defaultAdvisor(ab.base));
    // As the browser shows it (components/report/studio.tsx): the analysis' own notes while the scope is the analysis'.
    const shown = liveReport(report, a.live.deal, { demo: opts.demo, ...(sameScope ? {} : { scope: scopeNotes(ab.base, held, a) }) }).deal;
    const below = sameScope ? [] : (shown.costsBelowTypical ?? []);
    return {
      ok: true,
      scenario: {
        v: 2,
        inputs,
        ...(sameScope ? {} : { advisor: toStored(ab.base, held) }),
        snapshot: {
          verdict: shown.verdict,
          profit: a.live.deal.profit,
          maxOffer: a.live.deal.maxAllowableOffer,
          margin: a.live.margin,
          roiOnCost: a.live.roiOnCost,
          cashNeeded: a.live.cashNeeded,
          downside: a.live.deal.worstCaseProfit,
          rehab: a.cost.rehab,
          resale: a.resale,
          ...(below.length ? { belowTypical: below } : {}),
        },
        savedAt: opts.now.toISOString(),
      },
    };
  }

  if (sameInputs(inputs, base.inputs)) return { ok: true, scenario: null };
  const live = liveNumbers(base.rehab, base.resale, inputs, report.deal.purchasePrice);
  const shown = liveReport(report, live.deal, { demo: opts.demo }).deal;
  return {
    ok: true,
    scenario: {
      v: 1,
      inputs,
      snapshot: {
        verdict: shown.verdict,
        profit: live.deal.profit,
        maxOffer: live.deal.maxAllowableOffer,
        margin: live.margin,
        roiOnCost: live.roiOnCost,
        cashNeeded: live.cashNeeded,
        downside: live.deal.worstCaseProfit,
      },
      savedAt: opts.now.toISOString(),
    },
  };
}

/** A scenario as the Studio opens it: the inputs, and the advisor's state when one was kept (version 2). */
export interface OpenScenario {
  inputs: StudioInputs;
  advisor: AdvisorState | null;
}

/** A stored scenario this version can open (numbers still in range), else null. Version 1 opens on the analysis' scope. */
export function readScenario(value: unknown): OpenScenario | null {
  if (!value || typeof value !== "object") return null;
  const s = value as { v?: unknown; inputs?: unknown; advisor?: unknown };
  if (s.v !== 1 && s.v !== 2) return null;
  const parsed = scenarioInputs.safeParse(s.inputs);
  if (!parsed.success) return null;
  const inputs = clampInputs(parsed.data as StudioInputs);
  if (s.v === 1 || s.advisor === undefined) return { inputs, advisor: null };
  const adv = advisorInput.safeParse(s.advisor);
  return { inputs, advisor: adv.success ? advisorFromStored(adv.data) : null };
}
