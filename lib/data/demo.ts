/**
 * No imports on purpose: screens that only need to know "is this a demo?"
 * (client components included) take it from here without pulling the data
 * providers into their bundle.
 */

/**
 * Whether a result came from made-up market data. Every price the app shows
 * from such a result carries the word DEMO (components/ui/demo.tsx): no
 * number is presented as real unless real, dated sales are behind it. A
 * result that does not say where it came from was made before real data
 * existed, so it is a demo too.
 */
export function isDemoProvider(name: string | null | undefined): boolean {
  return !name || name === "synthetic";
}

export const DEMO_WARNING = {
  analysis: "Demo numbers. The sales and property records behind this result are made up, so the resale value, ceiling, max offer, profit and verdict are not real. Only the photo reading is real.",
  quick: "Demo numbers. The house and the sales behind this result are made up. Use it to see how the deal math reacts, not to price a real house.",
  list: "Demo numbers. Deals marked DEMO were worked out from made-up sales and property records, so their resale value, max offer, profit and verdict are not real.",
};
