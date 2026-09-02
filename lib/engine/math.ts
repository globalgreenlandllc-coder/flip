export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60 * 24 * 30.4375);
}

export interface Weighted {
  value: number;
  weight: number;
}

/** Weighted percentile by cumulative weight. p in [0, 1]. */
export function weightedPercentile(items: Weighted[], p: number): number {
  if (items.length === 0) return NaN;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, i) => s + i.weight, 0);
  if (total <= 0) return sorted[Math.floor((sorted.length - 1) * p)].value;
  const target = total * p;
  let cum = 0;
  for (const item of sorted) {
    cum += item.weight;
    if (cum >= target) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

export function weightedMedian(items: Weighted[]): number {
  return weightedPercentile(items, 0.5);
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
