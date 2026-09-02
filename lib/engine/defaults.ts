import type { DealInputs, MarketConfig } from "./types";

/**
 * PLACEHOLDER adjustment rates. Every number here must be fit per metro by
 * regressing sold price on characteristics within each submarket before
 * anyone pays for a report. pricePerSqftLiving is the marginal rate and
 * is normally well below average $/sqft.
 */
export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  pricePerSqftLiving: 140,
  pricePerSqftLot: 4,
  perBed: 8_000,
  perBath: 12_000,
  perGarage: 10_000,
  perYearAge: 500,
  conditionSteps: {
    distressed: -0.2,
    dated: -0.1,
    average: 0,
    updated: 0.06,
    renovated: 0.12,
  },
  monthlyAppreciation: 0.003,
  grossAdjustmentCap: 0.25,
  minComps: 5,
  maxComps: 8,
  rehabPerSqft: {
    distressed: [55, 75, 100],
    dated: [30, 42, 60],
    average: [18, 25, 35],
    updated: [8, 12, 18],
    renovated: [3, 5, 8],
  },
};

export const DEFAULT_DEAL_TERMS: Omit<DealInputs, "askingPrice" | "rehab"> = {
  hiddenRiskReserve: 0.12,
  holdingMonths: 6,
  monthlyHolding: 1_400,
  financing: { rate: 0.11, ltc: 0.85, points: 0.02 },
  closingBuyPct: 0.015,
  closingSellPct: 0.07,
  targetProfit: 60_000,
};
