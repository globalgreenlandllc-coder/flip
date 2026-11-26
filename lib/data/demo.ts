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

/**
 * Whether a result came from real sold prices that flip's method has not
 * been accuracy-tested on. That is every real result today: no area has
 * passed the test yet. Such a result carries the word UNTESTED in its
 * verdict and can never be a GO (lib/engine/gate.ts).
 */
export function isUntestedProvider(name: string | null | undefined): boolean {
  return name === "rentcast";
}

/**
 * What a result the browser sends back to be saved is saved as, or null when
 * it may not be saved at all.
 *
 * While this server has only made-up market data, nothing it saves can be
 * anything but a demo, whatever the browser says. With real data connected,
 * the browser's word is all there is for a result it computed earlier. It
 * may say the result was built on real sold prices: then the result is
 * marked UNTESTED wherever it is shown, and can never be a GO (no area has
 * passed its accuracy test). Whatever else it says, the result is saved as a
 * demo and marked DEMO. So nothing can be saved that a screen would show as
 * a verdict with no mark on it.
 */
export function providerToSave(claimed: unknown, verdict: unknown, realDataOn: boolean): "synthetic" | "rentcast" | null {
  if (!(realDataOn && claimed === "rentcast")) return "synthetic";
  return verdict === "GO" ? null : "rentcast";
}

export const DEMO_WARNING = {
  analysis: "Demo numbers. The sales and property records behind this result are made up, so the resale value, ceiling, max offer, profit and verdict are not real. Only the photo reading is real.",
  quick: "Demo numbers. The house and the sales behind this result are made up. Use it to see how the deal math reacts, not to price a real house.",
  list: "Demo numbers. Deals marked DEMO were worked out from made-up sales and property records, so their resale value, max offer, profit and verdict are not real.",
};

export const UNTESTED_WARNING = {
  analysis:
    "Real sold prices, untested estimate. The property record and the sold homes behind this result are real public records. The method that turns them into a resale value has not been tested against real completed flips in this area yet, and its adjustment rates are placeholders. Treat every number as a first look, check the sold homes yourself, and no result is a GO until the area passes its accuracy test.",
  list: "Untested estimates. Deals marked UNTESTED were worked out from real sold prices by a method that has not been accuracy-tested for their area yet. None of them is a GO.",
};
