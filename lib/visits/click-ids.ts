/**
 * The click ids a link may carry, and the network each comes from. `paid`: only a paid ad's link gets it. Facebook
 * puts fbclid on every link that leaves it, paid or not, so fbclid says Facebook and nothing about an ad. Only the
 * network and whether the id is a paid one are ever sent or kept, never the id itself (components/visit-beacon.tsx,
 * lib/visits/visit.ts). No server code here: the page reads this too.
 */
export const CLICK_IDS: { param: string; network: string; paid: boolean }[] = [
  { param: "gclid", network: "google", paid: true },
  { param: "gbraid", network: "google", paid: true },
  { param: "wbraid", network: "google", paid: true },
  { param: "dclid", network: "google", paid: true },
  { param: "msclkid", network: "bing", paid: true },
  { param: "ttclid", network: "tiktok", paid: true },
  { param: "twclid", network: "x", paid: true },
  { param: "li_fat_id", network: "linkedin", paid: true },
  { param: "epik", network: "pinterest", paid: true },
  { param: "sccid", network: "snapchat", paid: true },
  { param: "rdt_cid", network: "reddit", paid: true },
  { param: "fbclid", network: "facebook", paid: false },
];

/** What a link's query says about its click ids: the network of the first one found (paid ones first), and whether a paid-only one was there. */
export function clickOf(has: (param: string) => boolean): { click: string | null; ad: boolean } {
  const found = CLICK_IDS.filter((c) => has(c.param));
  return { click: found[0]?.network ?? null, ad: found.some((c) => c.paid) };
}
