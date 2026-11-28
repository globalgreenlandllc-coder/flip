/**
 * A saved Deal Studio scenario (2026-11-28): the person's own inputs for one deal, kept inside the deal's payload
 * (DealPayload.scenario) — no new column, no new table. One scenario per deal for now (the owner's decision): saving
 * again replaces it, and saving the analysis' own inputs removes it.
 *
 * What is kept is what the person chose (the inputs) and the numbers the SERVER worked out from them with the same
 * engine; numbers sent by a browser are never stored. The deal's own columns (verdict, resale, maximum offer, profit,
 * provider) stay the analysis', so the list of deals keeps showing what was analysed.
 */
import { z } from "zod";
import type { Report, Verdict } from "@/lib/engine/types";
import { STUDIO_BOUNDS, STUDIO_KEYS, clampInputs, liveNumbers, liveReport, sameInputs, studioBase, type StudioInputs } from "@/lib/engine/studio";

export interface ScenarioSnapshot {
  verdict: Verdict;
  profit: number;
  maxOffer: number;
  margin: number | null;
  roiOnCost: number | null;
  cashNeeded: number;
  downside: number;
}

export interface StoredScenario {
  v: 1;
  inputs: StudioInputs;
  /** Worked out on the server when it was saved. */
  snapshot: ScenarioSnapshot;
  /** ISO time it was saved. */
  savedAt: string;
}

const field = (k: keyof StudioInputs) =>
  z.number({ error: `${k} must be a number.` }).finite({ error: `${k} must be a number.` }).min(STUDIO_BOUNDS[k].min, { error: `${k} is out of range.` }).max(STUDIO_BOUNDS[k].max, { error: `${k} is out of range.` });

export const scenarioInputs = z.strictObject(Object.fromEntries(STUDIO_KEYS.map((k) => [k, field(k)])) as Record<keyof StudioInputs, z.ZodNumber>);

export type ScenarioResult = { ok: true; scenario: StoredScenario | null } | { ok: false; error: string };

/**
 * The scenario to keep with a deal, from the deal's own report and the person's inputs; null when the inputs are the
 * analysis' own (nothing to keep). An error, in words, when the inputs are not numbers in range or the deal cannot be
 * worked again (saved before Deal Studio kept its terms).
 */
export function scenarioFor(report: Report, raw: unknown, opts: { demo: boolean; now: Date }): ScenarioResult {
  const parsed = scenarioInputs.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Those numbers could not be read. Check the fields and try again." };
  const base = studioBase(report);
  if (!base.editable) return { ok: false, error: "This deal was saved before RenoFlip kept its assumptions, so it can only be shown as it was analyzed." };
  const inputs = clampInputs(parsed.data as StudioInputs);
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

/** A stored scenario's inputs, if it is one this version can open (and its numbers are still in range); else null. */
export function readScenario(value: unknown): StudioInputs | null {
  if (!value || typeof value !== "object") return null;
  const s = value as { v?: unknown; inputs?: unknown };
  if (s.v !== 1) return null;
  const parsed = scenarioInputs.safeParse(s.inputs);
  return parsed.success ? clampInputs(parsed.data as StudioInputs) : null;
}
