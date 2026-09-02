import type { Condition, MarketConfig, RehabRange } from "./types";

/**
 * Condition-tier rehab estimate. This is the placeholder until the photo
 * pipeline produces room-by-room scope. The likely figure is what feeds
 * the deal unless the user overrides it.
 */
export function rehabFromCondition(condition: Condition, sqft: number, cfg: MarketConfig): RehabRange {
  const [lo, likely, hi] = cfg.rehabPerSqft[condition];
  return { low: lo * sqft, likely: likely * sqft, high: hi * sqft };
}
