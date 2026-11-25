/**
 * Telling one street address from another. Pure, with nothing imported, so
 * the page reader and the form can both use it.
 */

const DIRECTION = /^(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)$/i;

/** What tells one street address from another: its number, the first word of its street, its zip. */
export function houseKey(address: string | undefined): { number: string; street: string; zip: string } | null {
  if (!address) return null;
  const number = address.match(/^\s*([NSEW]?\d{1,6}[A-Za-z]?(?:-\d{1,5})?)[\s,]/)?.[1];
  const zip = address.match(/(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if (!number || !zip) return null;
  const words = address.trim().slice(number.length).split(/[\s,]+/).map((word) => word.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  return { number: number.toLowerCase(), street: (words.find((word) => !DIRECTION.test(word)) ?? "").toLowerCase(), zip };
}

export type Same = "same" | "different" | "unknown";

/**
 * Are these the same house? "different" when the street number or the zip
 * differ; "same" when number, street and zip agree; "unknown" when either
 * address cannot be read, or the number and zip agree and the street is
 * written two ways ("Mt Vernon Rd", "Mount Vernon Rd").
 */
export function sameAddress(a: string | undefined, b: string | undefined): Same {
  const first = houseKey(a);
  const second = houseKey(b);
  if (!first || !second) return "unknown";
  if (first.number !== second.number || first.zip !== second.zip) return "different";
  return first.street === second.street ? "same" : "unknown";
}

/**
 * Does this text say this house's number and, on the same line and not far
 * after it, its zip? A check that does not depend on reading the address out
 * of the text, for the addresses no reader gets right: it is how a page is
 * known to be its link's house even when its address line could not be read.
 */
export function mentionsHouse(text: string, address: string | undefined): boolean {
  const key = houseKey(address);
  if (!key) return false;
  const number = key.number.replace(/[^a-z0-9-]/g, "");
  return new RegExp(`(?:^|[^A-Za-z0-9])${number}[ ,][^\\n]{0,80}?[^0-9]${key.zip}(?![0-9])`, "i").test(text.slice(0, 200_000));
}

// ── a line that is a street ─────────────────────────────────────────────────

/** A house number: 123, 123A, 123-45 (Queens), N1234 (Wisconsin). */
export const HOUSE_NUMBER = /^(?:\d{1,6}[A-Za-z]?|\d{1,5}-\d{1,5}|[NSEW]\d{2,6})$/;
/** What a street address is written with besides its number: words, ordinals ("224th"), a fraction, a unit ("#4"). */
export const STREET_WORD = /^(?:[A-Za-z][A-Za-z.'-]*|\d{1,5}(?:st|nd|rd|th)|\d\/\d|#[A-Za-z0-9-]+)$/i;

const COMPASS = String.raw`(?:n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\.?`;
const UNIT = String.raw`(?:#|(?:apt|apartment|unit|ste|suite|lot|spc|space|bldg)\.? ?#?) ?[a-z0-9-]{1,6}`;
/** How a street line ends: what kind of street it is, then perhaps a direction and a unit. */
const STREET_END = new RegExp(
  String.raw` (?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|blvd|boulevard|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|trl|trail|loop|sq|square|aly|alley|bnd|bend|xing|crossing|pt|point|pointe|run|path|row|walk|pass|cv|cove|rdg|ridge|vw|view|hts|heights|grv|grove|gln|glen|lndg|landing|vis|vista|plz|plaza|cres|crescent|pike|tpke|turnpike|mews|commons|broadway|trace|trce|hollow|holw|park|chase|close|bluff|blf|creek|crk|crest|hill|hills|knoll|knolls|manor|mnr|meadow|meadows|oaks|overlook|rise|shore|shores|summit|valley|village|wood|woods|bay|canyon|cyn|corner|corners|dale|harbor|haven|island|estates|gardens|springs|falls)\.?(?: ${COMPASS})?(?:,? ${UNIT})?$`,
  "i",
);
/** "1234 E 4500 S". */
const GRID_STREET = new RegExp(String.raw`^\d{1,6} ${COMPASS} \d{2,5} ${COMPASS}$`, "i");
/** "4567 Highway 99 N", "4567 Old Highway 99 S", "N1234 County Road X", "1234 US 31 N". */
const ROUTE_STREET = new RegExp(
  String.raw`^[nsew]?\d{1,6} (?:${COMPASS} )?(?:old |new )?(?:us|u\.s\.|highway|hwy|state route|state road|state highway|sr|county road|county rd|cr|route|rte|fm|rr|interstate) ?-?[a-z0-9]{1,5}(?: ${COMPASS})?$`,
  "i",
);
/** "123 Avenue C", "55 Calle Sol", "12 El Camino Real". */
const NAMED_FIRST_STREET = /^\d{1,6}[a-z]? (?:(?:el|la|los|las) )?(?:avenue|calle|via|camino|paseo|avenida|rue|plaza|rancho|corte) [a-z]/i;
const NOT_IN_A_STREET_LINE = new Set("in on at by for with of and to is from".split(" "));
export const UNIT_LINE = new RegExp(`^${UNIT}$`, "i");

/**
 * A line that is a street and its number and nothing else: "13013 224th St
 * E", "712 Day Lily Ln", "1234 E 4500 S". Read strictly, because it is only
 * used to put a street together with the city on the line under it, and the
 * line over a city can be anything: "Built in 1987", "1 of 37", "3 days on
 * Zillow", "24 Homes".
 */
export function streetLine(line: string): string | undefined {
  const text = line.replace(/,$/, "").trim();
  if (text.length > 60) return undefined;
  const words = text.split(" ").map((word) => word.replace(/,$/, ""));
  if (words.length < 2 || words.length > 8 || !HOUSE_NUMBER.test(words[0])) return undefined;
  if (!words.slice(1).every((word) => (STREET_WORD.test(word) || /^\d{1,5}$/.test(word)) && !NOT_IN_A_STREET_LINE.has(word.toLowerCase()))) return undefined;
  return STREET_END.test(text) || GRID_STREET.test(text) || ROUTE_STREET.test(text) || NAMED_FIRST_STREET.test(text) ? text : undefined;
}
