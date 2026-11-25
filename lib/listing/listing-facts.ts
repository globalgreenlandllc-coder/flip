/**
 * What a listing page says about the house, kept instead of thrown away: its
 * description, its facts, and the labelled lines of its detail sections
 * ("Sewer: Septic Tank", "Listing terms: Cash"), each with where on the page
 * it was read. The description is where "as-is", "cash only" and "failed
 * septic" live, and nothing downstream can read what was not kept.
 *
 * How a fact is read, and the rule behind it: a page says many things that
 * look like a fact about the house and are not. "Detached shop built in
 * 2019" is in the remarks of a 1948 house; "$452" under "Property taxes" in
 * a payment calculator is a month's worth; the similar homes further down
 * have bedrooms of their own. So a fact is taken only from a place that says
 * that one thing:
 *
 *   - a line of its own: "Year built: 1987", "Built in 1987", "7,405 sqft lot";
 *   - a label and its value in neighbouring cells or on neighbouring lines;
 *   - the page's own data, when every mention of it on the page agrees.
 *
 * Never from a sentence. Where the text has no lines to go by (the button on
 * a listing page hands over one unbroken run of text, and a link preview is a
 * sentence), what is found is marked `loose`: it is shown with the words
 * around it and never used for the numbers. A reading that needs a unit or a
 * period and has none ("Lot size: 7,405", "HOA: $420") is not guessed at; the
 * line is kept as written among the details instead.
 *
 * Pure parsing, bundled for the browser too (a pasted page is parsed there).
 * Every pattern is bounded and runs over one short line at a time.
 */

import { MAX_HTML_CHARS, MAX_LINES, MAX_TEXT_CHARS, decodeEntities, jsonLd, pageText } from "./html";
import { houseEnd } from "./zone";

export { pageText } from "./html";

/**
 * Where on the page a reading came from.
 *   data - the page's own structured data (JSON-LD, the JSON the page ships with)
 *   text - the page's visible text
 *   meta - the page's summary tags (what a link preview shows)
 *   link - the link itself
 */
export type FactSource = "data" | "text" | "meta" | "link";
export const FACT_SOURCES: FactSource[] = ["data", "text", "meta", "link"];

export interface Fact {
  value: number | string;
  source: FactSource;
  /** The page's own words the value was read from, when it was read from text. */
  seen?: string;
  /** Found in running text, not on a line of its own or in the page's data. Shown with its words; never used for the numbers. */
  loose?: true;
}

export const NUMBER_FACTS = ["price", "beds", "baths", "sqft", "lotSqft", "yearBuilt", "stories", "garage", "hoaMonthly", "taxAnnual", "daysOnMarket", "lat", "lng"] as const;
export const TEXT_FACTS = ["address", "propertyType", "status", "mlsId"] as const;
export type NumberFactKey = (typeof NUMBER_FACTS)[number];
export type TextFactKey = (typeof TEXT_FACTS)[number];
export type FactKey = NumberFactKey | TextFactKey;
export type ListingFacts = Partial<Record<FactKey, Fact>>;

export interface ListingDetail {
  label: string;
  value: string;
}

export interface ListingDescription {
  text: string;
  source: FactSource;
  /** Longer than is kept: this is its first MAX_DESCRIPTION_CHARS characters. */
  cut?: true;
  /** No heading and no data pointed at it: it is the first long paragraph of plain prose on the page. */
  unsure?: true;
}

export interface PageReading {
  description?: ListingDescription;
  facts: ListingFacts;
  details: ListingDetail[];
  /** The facts the page's shipped data gave (they are in `facts` too unless they contradict the page's text): for a caller that knows more to check them against. */
  data?: ListingFacts;
  /** On which line of the text (counting the lines that have something on them) each fact was first stated: the house's own numbers come before other homes'. */
  where?: Partial<Record<FactKey, number>>;
}

export const MAX_DESCRIPTION_CHARS = 6_000;
export const MAX_DETAILS = 40;
const SQFT_PER_ACRE = 43_560;
const THIS_YEAR = new Date().getUTCFullYear();

/** What each number can sanely be. Outside it, the reading is a misreading and is dropped. */
const RANGE: Record<NumberFactKey, [number, number]> = {
  price: [1_000, 100_000_000],
  beds: [0, 30],
  baths: [0, 30],
  sqft: [100, 50_000],
  lotSqft: [100, 50_000_000],
  yearBuilt: [1700, THIS_YEAR + 2],
  stories: [1, 10],
  garage: [0, 20],
  hoaMonthly: [0, 100_000],
  taxAnnual: [0, 10_000_000],
  daysOnMarket: [0, 10_000],
  lat: [-90, 90],
  lng: [-180, 180],
};

const WHOLE = new Set<NumberFactKey>(["beds", "yearBuilt", "garage", "daysOnMarket"]);

/** A fact as it may be kept, or null: a number inside its range, a short text, a known source. Shared with the server's input check. */
export function saneFact(key: string, fact: unknown): Fact | null {
  if (!fact || typeof fact !== "object") return null;
  const { value, source, seen, loose } = fact as { value?: unknown; source?: unknown; seen?: unknown; loose?: unknown };
  if (!FACT_SOURCES.includes(source as FactSource)) return null;
  const kept: Fact = { value: "", source: source as FactSource };
  if ((NUMBER_FACTS as readonly string[]).includes(key)) {
    const [min, max] = RANGE[key as NumberFactKey];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
    // Bedrooms, a year, garage spaces and days are counted in whole numbers; 2.75 bedrooms is a misreading.
    if (WHOLE.has(key as NumberFactKey) && !Number.isInteger(value)) return null;
    kept.value = value;
  } else if ((TEXT_FACTS as readonly string[]).includes(key)) {
    if (typeof value !== "string" || !value.trim()) return null;
    kept.value = value.trim().slice(0, 160);
  } else {
    return null;
  }
  if (typeof seen === "string" && seen.trim()) kept.seen = seen.trim().slice(0, 120);
  if (loose === true) kept.loose = true;
  return kept;
}

/** A fact's number, when it has one that may be relied on (not a loose reading). */
export function factNumber(facts: ListingFacts | undefined, key: NumberFactKey): number | undefined {
  const fact = facts?.[key];
  return fact && !fact.loose && typeof fact.value === "number" ? fact.value : undefined;
}

// ── numbers as listings write them ──────────────────────────────────────────

/** An area or a count: 7,405 · 0.25 · .25 · 1/4 · 2 1/2. */
const MEASURE = String.raw`(?:\d{1,3}(?:,\d{3}){1,2}(?:\.\d{1,3})?|\d{1,7}(?:\.\d{1,3})?(?: \d\/\d)?|\.\d{1,3}|\d\/\d)`;
const UNIT = String.raw`(?:sq\.? ?ft|sqft|square f(?:ee|oo)t|sf|acres?|ac)`;
/** Dollars: $1,200 · $95 · $5,432.10. */
const MONEY = String.raw`\$ ?(\d{1,3}(?:,\d{3}){1,3}|\d{1,9})(?:\.\d{2})?`;
const PERIOD = String.raw`(?:\/ ?|per |a |each )?(mo(?:nth(?:ly)?)?|yr|year(?:ly)?|annual(?:ly)?|qtr|quarter(?:ly)?|semi-?annual(?:ly)?|bi-?annual(?:ly)?|week(?:ly)?|wk)(?![a-z])`;
const YEAR = String.raw`((?:17|18|19|20)\d{2})(?!\d)`;
const TYPE = String.raw`(?:single[- ]family(?: residence| home| residential)?|condo(?:minium)?|town ?house|townhome|multi[- ]?family|manufactured(?: home)?|mobile(?: home)?|duplex|triplex|fourplex|co-?op|vacant land)`;
const STATUS = String.raw`(?:active under contract|under contract|active|pending|contingent|sold|closed|off market|coming soon|for sale)`;
const SITE = String.raw`(?:zillow|redfin|the market|market|realtor\.com|trulia|movoto|homes\.com|estately|site)`;

function measure(raw: string): number | undefined {
  const s = raw.replace(/,/g, "").trim();
  let m = s.match(/^(\d+) (\d)\/(\d)$/);
  if (m) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : undefined;
  m = s.match(/^(\d)\/(\d)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : undefined;
  const n = Number(s.startsWith(".") ? `0${s}` : s);
  return Number.isFinite(n) ? n : undefined;
}

const dollars = (raw: string | undefined) => {
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** A lot's size in square feet. Without a unit there is no telling 7,405 square feet from 0.17 acres, and nothing is read. */
function lotSqft(amount: string, unit: string | undefined): number | undefined {
  const n = measure(amount);
  if (n === undefined || !unit) return undefined;
  return Math.round(/^ac/i.test(unit) ? n * SQFT_PER_ACRE : n);
}

/** How many of this period make a month. "Biannually" means twice a year to some and every two years to others, so it is not read. */
function perMonth(word: string): number | undefined {
  const w = word.toLowerCase().replace(/-/g, "");
  if (w.startsWith("mo")) return 1;
  if (/^(?:yr|year|annual)/.test(w)) return 1 / 12;
  if (/^(?:qtr|quarter)/.test(w)) return 1 / 3;
  if (w.startsWith("semiannual")) return 1 / 6;
  if (/^(?:week|wk)/.test(w)) return 52 / 12;
  return undefined;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
const count = (raw: string): number | undefined => (/^\d/.test(raw) ? Number(raw) : WORD_NUMBERS[raw.toLowerCase()]);

/** A listing number has digits in it; "GRID" and "listing" are not one. */
const mlsNumber = (raw: string): string | undefined => ((raw.match(/\d/g)?.length ?? 0) >= 4 ? raw : undefined);

// ── a label and its value ───────────────────────────────────────────────────

type Found = { key: FactKey; value: number | string };

const labelled = (key: FactKey, labels: string[]): [string, FactKey][] => labels.map((label) => [label, key]);

/** The labels listing pages put before a fact, lower-cased, without a closing colon or "#". */
const PAIR_LABELS = new Map<string, FactKey>([
  ...labelled("yearBuilt", ["year built", "built", "yr built", "year constructed"]),
  ...labelled("lotSqft", [
    "lot size", "lot", "lot area", "lot size area", "lot sqft", "lot sq ft", "lot square feet", "lot size (sq ft)", "lot size (sqft)", "lot size sq ft", "lot size sqft",
    "lot size square feet", "lot size (square feet)", "lot acres", "lot size acres", "lot size (acres)", "acres", "acreage", "lot acreage",
  ]),
  ...labelled("sqft", [
    "living area", "total interior livable area", "interior livable area", "livable area", "total living area", "living area total", "square feet", "square footage",
    "sq ft", "sqft", "home size", "finished square feet", "finished sq ft", "total finished area", "building area total", "living area (sq ft)", "living area (sqft)",
  ]),
  ...labelled("beds", ["bedrooms", "beds", "bedrooms total", "total bedrooms"]),
  ...labelled("baths", ["bathrooms", "baths", "bathrooms total", "total bathrooms"]),
  ...labelled("stories", ["stories", "story", "levels", "floors", "number of stories", "stories total"]),
  ...labelled("garage", ["garage spaces", "garage", "attached garage spaces", "garage spaces total", "number of garage spaces"]),
  ...labelled("hoaMonthly", [
    "hoa", "hoa fee", "hoa fees", "hoa dues", "association fee", "association fees", "association dues", "monthly hoa", "monthly hoa fee", "monthly hoa dues",
    "monthly association fee", "hoa fee monthly", "homeowners association fee", "homeowner association fee",
  ]),
  ...labelled("daysOnMarket", [
    "days on market", "days on zillow", "days on redfin", "days on site", "days on realtor.com", "days on trulia", "cumulative days on market", "dom",
    "time on zillow", "time on redfin", "time on realtor.com", "time on market", "time on site", "time on trulia",
  ]),
  ...labelled("mlsId", ["mls", "mls id", "mls number", "mls no", "mls no.", "mls listing id", "mls listing number", "mls listing"]),
  ...labelled("propertyType", ["property type", "home type", "property subtype", "property sub type", "property sub-type", "type"]),
  ...labelled("status", ["status", "listing status", "property status", "mls status"]),
  ...labelled("price", ["list price", "listing price", "price", "asking price", "listed for", "listed at"]),
]);

/** "Property taxes", "2025 taxes", "Annual tax amount", "Taxes (2025)". */
const TAX_LABEL = /^(?:(?:19|20)\d{2} )?(?:annual |yearly )?(?:property |real estate )?tax(?:es)?(?: amount| annual amount| bill)?(?: \(?(?:(?:19|20)\d{2}|annual|yearly)\)?)?$/;

const normalLabel = (label: string) => label.toLowerCase().replace(/[\s:#]+$/, "").replace(/\s+/g, " ").trim();

const PAIR_READERS: Record<Exclude<FactKey, "taxAnnual" | "lat" | "lng" | "address">, (value: string, label: string) => number | string | undefined> = {
  yearBuilt: (v) => {
    const m = v.match(new RegExp(`^${YEAR}`));
    return m ? Number(m[1]) : undefined;
  },
  lotSqft: (v, label) => {
    const m = v.match(new RegExp(`^(${MEASURE})(?![\\d/,])(?: ?(${UNIT})(?![a-z]))?`, "i"));
    if (!m) return undefined;
    // The unit is in the value, or in the label: "Lot size (sq ft): 7,405", "Acres: 1.02".
    return lotSqft(m[1], m[2] ?? (/sq|square/.test(label) ? "sqft" : /acre/.test(label) ? "acres" : undefined));
  },
  sqft: (v) => {
    const m = v.match(/^(\d{1,2},\d{3}|\d{3,5})(?![\d,.])(?! ?ac)/i);
    return m ? dollars(m[1]) : undefined;
  },
  beds: (v) => {
    // "3+" is a search filter's, not a house's.
    const m = v.match(/^(\d{1,2})(?![\d.,+])/);
    return m ? Number(m[1]) : undefined;
  },
  baths: (v) => {
    // "2 full, 1 half" is two and a half.
    const split = v.match(/^(\d{1,2}) full(?:,| and|,? \+)? (\d) (?:half|partial)\b/i);
    if (split) return Number(split[1]) + Number(split[2]) / 2;
    // "2/1" is two full and one half. "1/2" could as well be half a bath, and is left alone.
    const slash = v.match(/^(\d{1,2})\/(\d)(?![\d.,/])/);
    if (slash) return slash[0] === "1/2" ? undefined : Number(slash[1]) + Number(slash[2]) / 2;
    const m = v.match(/^(\d{1,2}(?:\.\d{1,2})?)(?![\d.,+/])/);
    return m ? Number(m[1]) : undefined;
  },
  stories: (v) => {
    const m = v.match(/^(\d(?:\.5)?|one|two|three|four)(?: ?(?:stor(?:y|ies)|levels?|floors?))?$/i);
    return m ? count(m[1]) : undefined;
  },
  garage: (v) => {
    const m = v.match(/^(\d{1,2})(?:[- ]?(?:cars?|spaces?|stalls?))?(?:,? (?:attached|detached))?$/i);
    return m ? Number(m[1]) : undefined;
  },
  hoaMonthly: (v, label) => {
    if (/^(?:none|no|\$ ?0(?:\.00)?(?: ?(?:\/ ?|per |a )?[a-z]{2,10})?)$/i.test(v)) return 0;
    const m = v.match(new RegExp(`^${MONEY}(?![\\d,])(?: ?${PERIOD})?`, "i"));
    const n = dollars(m?.[1]);
    if (!m || n === undefined) return undefined;
    // A fee with no period is not a monthly fee until the page says so.
    const each = m[2] ? perMonth(m[2]) : /month/.test(label) ? 1 : undefined;
    return each === undefined ? undefined : Math.round(n * each);
  },
  daysOnMarket: (v, label) => {
    const m = v.match(/^(\d{1,4}) ?(days?|hours?|hrs?|minutes?|mins?)?$/i);
    if (!m) return undefined;
    if (!m[2]) return label.startsWith("time") ? undefined : Number(m[1]);
    return /^d/i.test(m[2]) ? Number(m[1]) : 0;
  },
  mlsId: (v) => {
    const m = v.match(/^#? ?([A-Za-z0-9][A-Za-z0-9-]{3,14})(?:$|[ ,;(])/);
    return m ? mlsNumber(m[1]) : undefined;
  },
  propertyType: (v) => v.match(new RegExp(`^${TYPE}(?![a-z])`, "i"))?.[0],
  status: (v) => v.match(new RegExp(`^${STATUS}(?![a-z])`, "i"))?.[0],
  price: (v) => {
    const m = v.match(/^\$ ?(\d{1,3}(?:,\d{3}){1,2}|\d{5,9})(?:$|[ (])/);
    const n = dollars(m?.[1]);
    return n !== undefined && n >= 10_000 ? n : undefined;
  },
};

/** A year's taxes. "Property taxes $452" in a payment calculator is a month's, so a tax line is read only when it says it is a year's. */
function taxFromPair(label: string, value: string): number | undefined {
  const m = value.match(new RegExp(`^${MONEY}(?![\\d,])(.{0,40})`));
  const n = dollars(m?.[1]);
  if (!m || n === undefined) return undefined;
  const rest = m[2].toLowerCase();
  if (/(?:\/ ?|per |a |each )mo|\bmonth|\bmo\b/.test(rest)) return undefined;
  const yearly = /annual|yearly|(?:19|20)\d{2}/.test(label) || /(?:\/ ?|per |a )(?:yr|year)|annual|yearly|\((?:19|20)\d{2}\)/.test(rest);
  return yearly ? n : undefined;
}

function fromPair(labelRaw: string, valueRaw: string): Found | undefined {
  const label = normalLabel(labelRaw);
  const value = valueRaw.trim();
  if (!label || !value) return undefined;
  if (TAX_LABEL.test(label)) {
    const tax = taxFromPair(label, value);
    return tax === undefined ? undefined : { key: "taxAnnual", value: tax };
  }
  const key = PAIR_LABELS.get(label);
  if (!key) return undefined;
  const read = PAIR_READERS[key as keyof typeof PAIR_READERS];
  const found = read?.(value, label);
  return found === undefined ? undefined : { key, value: found };
}

// ── a line that says one fact with no label ─────────────────────────────────

const lot = (m: RegExpMatchArray) => lotSqft(m[1], m[2]);
const fee = (m: RegExpMatchArray) => {
  const n = dollars(m[1]);
  const each = perMonth(m[2]);
  return n === undefined || each === undefined ? undefined : Math.round(n * each);
};
const days = (m: RegExpMatchArray) => (/^d/i.test(m[2]) ? Number(m[1]) : 0);

/** Each matches a whole line or nothing: "Built in 1987" is a fact, "Detached shop built in 2019 with 220 power" is a sentence. */
const STATEMENTS: [FactKey, RegExp, (m: RegExpMatchArray) => number | string | undefined][] = [
  ["yearBuilt", new RegExp(`^(?:year )?built(?: in)? ${YEAR}$`, "i"), (m) => Number(m[1])],
  ["lotSqft", new RegExp(`^(${MEASURE})[- ]?(${UNIT})\\.?[- ]lot(?: size)?$`, "i"), lot],
  ["lotSqft", new RegExp(`^lot(?: size)? (${MEASURE}) ?(${UNIT})\\.?$`, "i"), lot],
  ["lotSqft", new RegExp(`^(${MEASURE}) ?(acres?)$`, "i"), lot],
  ["hoaMonthly", new RegExp(`^${MONEY} ?${PERIOD} hoa(?: fees?| dues)?$`, "i"), fee],
  ["hoaMonthly", new RegExp(`^hoa(?: fees?| dues)? ${MONEY} ?${PERIOD}$`, "i"), fee],
  ["hoaMonthly", /^(?:no hoa(?: fees?| dues)?|hoa(?: fees?| dues)? (?:none|no))$/i, () => 0],
  ["taxAnnual", new RegExp(`^annual (?:property )?tax(?:es| amount)? ${MONEY}$`, "i"), (m) => dollars(m[1])],
  ["daysOnMarket", new RegExp(`^(\\d{1,4}) (days?|hours?|hrs?|minutes?|mins?) on ${SITE}$`, "i"), days],
  ["propertyType", new RegExp(`^${TYPE}$`, "i"), (m) => m[0]],
  ["stories", /^(\d(?:\.5)?|one|two|three)[- ]stor(?:y|ies)$/i, (m) => count(m[1])],
  // The headline numbers on lines of their own: "4 beds" / "3 baths" / "2,340 sqft".
  ["beds", /^(\d{1,2}) ?(?:bedrooms?|beds?|bds?|br)$/i, (m) => Number(m[1])],
  ["baths", /^(\d{1,2}(?:\.\d{1,2})?) ?(?:bathrooms?|baths?|ba)$/i, (m) => Number(m[1])],
  ["sqft", /^(?:(?:approx(?:\.|imately)?|about|~) ?)?(\d{1,2},\d{3}|\d{3,5}) ?(?:sq\.? ?ft\.?|sqft|square f(?:ee|oo)t|sf)$/i, (m) => dollars(m[1])],
  ["garage", /^(\d{1,2})[- ](?:car[- ])?(?:attached[- ]|detached[- ])?garage(?: spaces?)?$/i, (m) => Number(m[1])],
];

/** "MLS #2301234", "MLS#: 2301234", "MLS ID 2301234": the word alone is not enough, it has to say it is a number. */
const MLS_IN_LINE = /(?:^|[^a-z])mls ?(?:#|id|number|no\.?|listing id|listing number)[ :#]{0,3}([A-Za-z0-9][A-Za-z0-9-]{3,14})(?![A-Za-z0-9-])/i;

function fromStatement(text: string): Found | undefined {
  for (const [key, pattern, read] of STATEMENTS) {
    const m = text.match(pattern);
    if (!m) continue;
    const value = read(m);
    if (value !== undefined) return { key, value };
  }
  return undefined;
}

// ── the labelled lines of the detail sections ───────────────────────────────

/**
 * The labels worth keeping as written: what decides whether a house can be
 * financed, occupied, renovated and resold, what it is built of, and the
 * lines about its lot, dues and taxes that could not be read as a number.
 */
const DETAIL_LABELS = new Map<string, string>(
  [
    "Sewer", "Water source", "Water", "Utilities", "Electric", "Gas",
    "Listing terms", "Special listing conditions", "Special conditions", "Possession", "Occupancy", "Occupant type", "Ownership",
    "Property condition", "Condition", "Disclosures", "Easements", "Flood zone", "Zoning", "Parcel number", "APN", "Tax ID",
    "New construction", "Year renovated", "Roof", "Heating", "Cooling", "Foundation", "Basement", "Construction materials", "Flooring", "Architectural style", "Parking features",
    "Lot size", "Lot", "Lot area", "Lot features", "Lot description", "Lot dimensions", "Acreage",
    "HOA", "HOA fee", "HOA fees", "HOA dues", "Has HOA", "Association fee", "Association dues", "Association fee frequency", "HOA fee frequency",
    "Property taxes", "Property tax", "Taxes", "Tax amount", "Annual tax amount", "Tax year",
  ].map((label) => [label.toLowerCase(), label]),
);

/** The label as flip writes it, if it is one of the labels kept; undefined for any other. Shared with the server's input check. */
export const detailLabel = (label: string): string | undefined => DETAIL_LABELS.get(label.toLowerCase().replace(/[\s:#]+$/, "").replace(/\s+/g, " ").trim());

// ── reading the lines ───────────────────────────────────────────────────────

/** Fractions written as one character become the two numbers they are: "¼ acre" is "1/4 acre", "2½" is "2 1/2". */
const plainNumbers = (s: string) => (/[¼½¾]/.test(s) ? s.replace(/(\d)?([¼½¾])/g, (_, before: string | undefined, f: string) => `${before ? `${before} ` : ""}${f === "¼" ? "1/4" : f === "½" ? "1/2" : "3/4"}`) : s);

function toLines(text: string): string[] {
  const lines: string[] = [];
  let size = 0;
  for (const raw of text.slice(0, MAX_TEXT_CHARS * 2).split(/\r?\n/)) {
    // A row copied out of a table arrives with tabs between its cells: two cells are a label and its value.
    const cells = raw.includes("\t") ? raw.split("\t").map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean) : null;
    const line = plainNumbers(cells ? (cells.length === 2 ? `${cells[0].replace(/\s?:$/, "")}: ${cells[1]}` : cells.join(" | ")) : raw.replace(/\s+/g, " ").trim());
    if (!line) continue;
    size += line.length + 1;
    if (size > MAX_TEXT_CHARS || lines.length >= MAX_LINES) break;
    lines.push(line);
  }
  return lines;
}

const MAX_STATEMENT_CHARS = 200;
/** A line that names a space that is not the house: what stands right under it is that space's. */
const OTHER_SPACE =
  /^(?:(?:detached |attached )?(?:shop|workshop|garage|carport|barn|shed|studio|office|storage|outbuilding|pool house|cabana|casita|guest (?:house|suite|quarters|cottage)|adu|accessory (?:dwelling )?unit|in-law (?:suite|unit|apartment)|mother-in-law(?: suite| unit)?|apartment|basement|attic|loft|bonus room|deck|patio|porch|second unit|rental unit|unit [a-z0-9]{1,3}))[: ]*$/i;
/** A line that is a label, a colon and a value. The label is short and starts like a word. */
const pairOf = (line: string) => line.match(/^([A-Za-z0-9#][^:]{0,47}):\s?(\S.{0,170})$/);
const withoutColon = (line: string) => line.replace(/\s?:$/, "");
const isLabel = (line: string) => {
  const label = normalLabel(line);
  return PAIR_LABELS.has(label) || DETAIL_LABELS.has(label) || TAX_LABEL.test(label);
};

/**
 * The longest known label a line starts with, for lines that leave the colon
 * out: "Lot Size 7,405 Sq. Ft.". The value is three words at most: more than
 * that after a label word is a sentence that happens to start with one.
 */
const LABEL_FIRST = new RegExp(`^(${[...PAIR_LABELS.keys()].sort((a, b) => b.length - a.length).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}) (\\S{1,20}(?: \\S{1,20}){0,2})$`, "i");

interface Seen {
  value: number | string;
  seen: string;
  /** The line it was first stated on. */
  line: number;
}

/** Two readings of the same number agree when they are the same, or for a lot when they are the same size said in two units. */
function agree(key: FactKey, a: number | string, b: number | string): boolean {
  if (typeof a === "string" || typeof b === "string") return String(a).toLowerCase() === String(b).toLowerCase();
  if (key === "lotSqft") return Math.abs(a - b) <= Math.max(250, 0.015 * Math.max(a, b));
  return a === b;
}

/**
 * The facts and detail lines the page's lines give, and the line each fact
 * was first stated on. The first statement of a fact is the one kept.
 */
function readLines(lines: string[], source: FactSource): { facts: ListingFacts; details: ListingDetail[]; where: Partial<Record<FactKey, number>> } {
  const found = new Map<FactKey, Seen>();
  const details: ListingDetail[] = [];
  const have = new Set<string>();
  /** The line being read. */
  let at = 0;
  // The first statement of a fact stands. A page says its own house first, and a later line
  // that says otherwise ("Year built: 2021" in a card further down) is another home's.
  const note = (hit: Found, seen: string) => {
    if (!found.has(hit.key)) found.set(hit.key, { value: hit.value, seen: seen.slice(0, 120), line: at });
  };
  const detail = (labelRaw: string, valueRaw: string) => {
    const label = DETAIL_LABELS.get(normalLabel(labelRaw));
    const value = valueRaw.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!label || !value || details.length >= MAX_DETAILS) return;
    const key = `${label}|${value.toLowerCase()}`;
    if (have.has(key)) return;
    have.add(key);
    details.push({ label, value });
  };
  /** One label and its value, as a fact if it reads as one, else as a detail line if its label is worth keeping. */
  const pair = (label: string, value: string, seen: string) => {
    const hit = fromPair(label, value);
    if (hit) note(hit, seen);
    else detail(label, value);
  };
  /** One stretch of a line that may state a fact by itself. */
  const statement = (text: string) => {
    if (text.length > MAX_STATEMENT_CHARS) return;
    const m = pairOf(text);
    if (m) return pair(m[1], m[2], text);
    const bare = text.match(LABEL_FIRST);
    const hit = (bare && fromPair(bare[1], bare[2])) || fromStatement(text);
    // "Shop" / "Approx. 1,200 sq. ft.": a size or a room count right under a line that names another space is that space's.
    if (hit && (hit.key === "sqft" || hit.key === "beds" || hit.key === "baths") && OTHER_SPACE.test(lines[at - 1] ?? "")) return;
    if (hit) note(hit, text);
  };

  /** A line that can be the value beside a label standing alone: short, and not a label or a pair itself. */
  const isValue = (line: string | undefined): line is string => Boolean(line && (line.length >= 2 || /\d/.test(line)) && line.length <= 160 && !isLabel(withoutColon(line)) && !pairOf(line));
  const isLabelAlone = (line: string) => line.length <= 60 && !pairOf(line) && isLabel(withoutColon(line));
  /** The fact a label standing alone would give with this line as its value. A price is not read this way: a column of prices under the word "Price" belongs to other houses. */
  const beside = (label: string, value: string | undefined) => {
    const known = normalLabel(label);
    return value && (TAX_LABEL.test(known) || (PAIR_LABELS.has(known) && PAIR_LABELS.get(known) !== "price")) ? fromPair(label, value) : undefined;
  };

  // Pages put a label's value under it ("Year built" / "1987") or over it ("1987" / "Year
  // built"). Which way this page does it is told by the labels only one neighbour fits.
  let over = 0;
  let under = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isLabelAlone(lines[i])) continue;
    const label = withoutColon(lines[i]);
    const above = isValue(lines[i - 1]) ? beside(label, lines[i - 1]) : undefined;
    const below = isValue(lines[i + 1]) ? beside(label, lines[i + 1]) : undefined;
    if (above && !below) over++;
    if (below && !above) under++;
  }
  const valuesAbove = over > under ? true : under > over ? false : undefined;
  /** The line last taken as a label's value: it is not also the value of the label after it. */
  let taken = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    at = i;
    if (line.length > MAX_STATEMENT_CHARS) continue;
    const mls = line.match(MLS_IN_LINE);
    const id = mls ? mlsNumber(mls[1]) : undefined;
    if (mls && id) note({ key: "mlsId", value: id }, mls[0].replace(/^[^A-Za-z]/, "").trim());

    if (isLabelAlone(line)) {
      const label = withoutColon(line);
      const above = valuesAbove !== false && taken !== i - 1 && isValue(lines[i - 1]) ? lines[i - 1] : undefined;
      const below = valuesAbove !== true && isValue(lines[i + 1]) ? lines[i + 1] : undefined;
      const fromAbove = beside(label, above);
      const fromBelow = beside(label, below);
      if (fromAbove && fromBelow) {
        // Both neighbours read as this fact. The label after it settles it when the line between
        // them is that label's value and nothing else can be ("4 / Beds / 3 / Baths / 2,340 / Sq
        // Ft": "3" is the Baths', so "4" is the Beds'). Otherwise there is no telling.
        const after = lines[i + 2];
        if (after !== undefined && isLabelAlone(after) && beside(withoutColon(after), below) && !(isValue(lines[i + 3]) && beside(withoutColon(after), lines[i + 3]))) note(fromAbove, `${label}: ${above}`);
      } else if (fromAbove) {
        note(fromAbove, `${label}: ${above}`);
      } else if (fromBelow) {
        note(fromBelow, `${label}: ${below}`);
        taken = i + 1;
        i++;
      } else if (valuesAbove && above) {
        detail(label, above);
      } else if (!valuesAbove && below) {
        // Not a fact that could be read: kept as written if its label is worth keeping.
        detail(label, below);
        taken = i + 1;
        i++;
      }
      continue;
    }
    // The value standing over its label ("7,405 sq ft" / "Lot Size") is that label's, not a statement of its own.
    const under = lines[i + 1];
    if (valuesAbove !== false && under !== undefined && isLabelAlone(under) && isValue(line) && beside(withoutColon(under), line)) continue;
    // Cells of one row, or chips set apart by dots: each may say a fact of its own.
    const parts = /\s[|·•]\s/.test(line) ? line.split(/\s[|·•]\s/).slice(0, 12) : null;
    if (!parts) {
      statement(line);
      continue;
    }
    // "Year built | 1987 | Lot size | 7,405 sqft": labels and values in turn, all the way along.
    // A label with two cells after it ("Year built | 1987 | 2004") is a table comparing this
    // house with others, and which column is ours is not ours to guess.
    const cells = parts.map((part) => part.trim());
    const inTurn = cells.length % 2 === 0 && cells.every((cell, p) => (p % 2 === 0) === (isLabel(cell) && !pairOf(cell)));
    if (inTurn) for (let p = 0; p < cells.length; p += 2) pair(cells[p], cells[p + 1], `${cells[p]}: ${cells[p + 1]}`);
    else for (const cell of cells) statement(cell);
  }

  const facts: ListingFacts = {};
  const where: Partial<Record<FactKey, number>> = {};
  for (const [key, one] of found) {
    const fact = saneFact(key, { value: one.value, source, seen: one.seen });
    if (!fact) continue;
    facts[key] = fact;
    where[key] = one.line;
  }
  return { facts, details, where };
}

// ── facts in text that has no lines ─────────────────────────────────────────

/** Not a digit, a slash, a dot or a comma before the number: "1/4 acre" is not 4 acres and "2,340" is not 340. */
const NOT_MID_NUMBER = String.raw`(?:^|[^\d/.,$])`;

/**
 * What unbroken text seems to say: the button on a listing page hands over
 * the top of the page as one run of words, and a link preview is a sentence.
 * There is no telling a fact line from a remark in it, so everything found
 * here is `loose`, with the words before it kept so a person can see whether
 * "built in 2019" was the house or the shop.
 */
function looseFacts(flat: string, source: FactSource): ListingFacts {
  const facts: ListingFacts = {};
  const put = (key: FactKey, value: number | string | undefined, m: RegExpMatchArray) => {
    if (value === undefined || facts[key]) return;
    const at = m.index ?? 0;
    // The words before it too, back to the start of its sentence: "Detached shop built in 2019" reads differently from "built in 2019".
    const from = Math.max(0, at - 40);
    const before = (from ? flat.slice(from, at).replace(/^\S*\s/, "") : flat.slice(0, at)).replace(/^.*[.!?;|·•]\s/, "");
    const seen = `${before}${m[0]}`.trim();
    const fact = saneFact(key, { value, source, seen, loose: true });
    if (fact) facts[key] = fact;
  };
  let m: RegExpMatchArray | null;
  if ((m = flat.match(new RegExp(`\\b(?:year built:?|built in) ?${YEAR}`, "i")))) put("yearBuilt", Number(m[1]), m);
  if ((m = flat.match(new RegExp(`\\blot(?: size)?:? ?(${MEASURE}) ?(${UNIT})(?![a-z])`, "i")) ?? flat.match(new RegExp(`${NOT_MID_NUMBER}(${MEASURE}) ?(${UNIT})\\.? lot\\b(?! (?:features|description|dimensions|details|size|area|number)|:)`, "i")))) put("lotSqft", lotSqft(m[1], m[2]), m);
  if ((m = flat.match(new RegExp(`\\bhoa(?: dues| fees?)?:? ?${MONEY}(?![\\d,]) ?${PERIOD}`, "i")) ?? flat.match(new RegExp(`${MONEY}(?![\\d,]) ?${PERIOD} hoa\\b`, "i")))) put("hoaMonthly", fee(m), m);
  if ((m = flat.match(new RegExp(`\\bannual tax(?: amount)?:? ?${MONEY}(?![\\d,])`, "i")))) put("taxAnnual", dollars(m[1]), m);
  if ((m = flat.match(new RegExp(`${NOT_MID_NUMBER}(\\d{1,4}) (days?) on ${SITE}\\b`, "i")))) put("daysOnMarket", Number(m[1]), m);
  if ((m = flat.match(MLS_IN_LINE))) put("mlsId", mlsNumber(m[1]), m);
  if ((m = flat.match(new RegExp(`\\b(?:property type|home type):? ?(${TYPE})(?![a-z])`, "i")))) put("propertyType", m[1], m);
  if ((m = flat.match(/\bgarage spaces?:? ?(\d{1,2})(?![\d.,])/i))) put("garage", Number(m[1]), m);
  return facts;
}

// ── the description ─────────────────────────────────────────────────────────

const DESCRIPTION_HEADINGS = new Set([
  "what's special", "what’s special", "about this home", "about this property", "about the home", "about this house", "description", "property description", "listing description",
  "home description", "overview", "property overview", "remarks", "public remarks", "marketing remarks", "listing remarks",
]);
const DESCRIPTION_INLINE = /^(?:description|property description|listing description|public remarks|marketing remarks|remarks)\s?:\s?(\S.{20,})$/i;
/** A line that starts another part of the page, whatever follows it. */
const SECTION = /^(?:facts (?:&|and) features|property details|home details|home facts|key details|home highlights|property information|price history|tax history|price (?:&|and) tax history|sale (?:&|and) tax history|public facts|schools?|nearby schools|nearby homes|similar homes|neighborhood|getting around|payment calculator|monthly (?:cost|payment)|estimated monthly (?:cost|payment)|climate risks?|home value|what locals say|open houses?|request a tour|tour this home|take a tour|contact (?:agent|an agent)|ask (?:a|an) [a-z ]{3,30})$/i;
/** Where the page goes on to say who listed the house. Told by its form ("Listed by Jane Doe", "Source: NWMLS"), not by its first words: "Listing agent is related to the seller." is a line of the remarks. */
const ATTRIBUTION = /^(?:Listed by:? [A-Z]|Listing (?:provided|courtesy) (?:by|of)\b|Listing (?:agent|office|broker|by)\s?:|Courtesy of\b|Source\s?:|MLS ?#)/;
/** A word that is a part of some pages and a line of the remarks on others ("Interior" above a paragraph about it): it ends the description only when no prose follows it. */
const MAYBE_SECTION = /^(?:interior|exterior|overview|details|features|highlights|amenities|location|utilities|construction|parking|financial|community|property|lot|other)(?: (?:features|details|information))?$/i;
const READ_MORE = /^(?:show|read|see|view) (?:more|less)$|^continue reading$|^more$/i;

/**
 * Where a paragraph says it is small print, a notice or a school blurb, not
 * a house. Most of these may sit anywhere in it. "Deemed reliable but not
 * guaranteed" may not: agents end their own remarks with it, so it counts
 * only where a paragraph opens with it.
 */
const NOT_ABOUT_THE_HOUSE = /©|copyright|all rights reserved|internet data exchange|\bIDX\b|terms of use|privacy policy|cookies|equal housing|personal, non-commercial|greatschools|school (?:service )?boundaries|school district prior/i;
const OPENS_LIKE_SMALL_PRINT = /deemed reliable|not guaranteed|subject to change|information (?:is|being) provided|listing data|data (?:is )?provided/i;
const isProse = (line: string) => line.length >= 60 && /[.!?](?:\s|$)/.test(line);
const looksLikeRemarks = (line: string) =>
  line.length >= 120 && (line.match(/[.!?](?:\s|$)/g)?.length ?? 0) >= 2 && (line.match(/[A-Za-z]/g)?.length ?? 0) / line.length > 0.7 && !NOT_ABOUT_THE_HOUSE.test(line) && !OPENS_LIKE_SMALL_PRINT.test(line.slice(0, 100));

const isKnownPair = (line: string | undefined) => {
  const m = line ? pairOf(line) : null;
  return Boolean(m && isLabel(m[1]));
};

type Described = Omit<ListingDescription, "source">;

/** The lines under the heading at `i`, as far as the description goes, and whether a paragraph of prose is among them. */
function underHeading(lines: string[], i: number, opening: string | undefined): (Described & { prose: boolean }) | undefined {
  const kept: string[] = opening ? [opening] : [];
  let size = opening ? opening.length : 0;
  let cut = false;
  let prose = opening ? isProse(opening) : false;
  /** Lines since the last paragraph of prose. A few are bullets; many are the page going on to something else. */
  let short = 0;
  for (let j = i + 1; j < lines.length && kept.length < 80; j++) {
    const line = lines[j];
    // "Show more", and a line that states a fact of its own ("12 days on Zillow"), are not part of the remarks.
    if (READ_MORE.test(line) || (line.length <= 60 && fromStatement(line))) continue;
    if (SECTION.test(line) || ATTRIBUTION.test(line) || DESCRIPTION_HEADINGS.has(withoutColon(line).toLowerCase())) break;
    if (MAYBE_SECTION.test(line) && !isProse(lines[j + 1] ?? "")) break;
    if (isKnownPair(line) && isKnownPair(lines[j + 1])) break;
    if (size + line.length > MAX_DESCRIPTION_CHARS) {
      kept.push(line.slice(0, Math.max(0, MAX_DESCRIPTION_CHARS - size)));
      cut = true;
      break;
    }
    kept.push(line);
    size += line.length + 1;
    if (isProse(line)) {
      prose = true;
      short = 0;
    } else if (++short >= (prose ? 8 : 16)) {
      // Past the remarks: what was collected since the last paragraph is not part of them.
      if (prose) kept.length -= short;
      break;
    }
  }
  const text = kept.join("\n").trim();
  if (text.length < 20 || !/[A-Za-z]{3}/.test(text)) return undefined;
  return cut ? { text, cut: true, prose } : { text, prose };
}

/** Lines that are words, not figures: "Sold as-is." and "Cash only." are; "4 Beds" and "$192 per Sq Ft" are not. */
const readsAsWords = (text: string) => {
  const lines = text.split("\n");
  return lines.filter((line) => !/\d/.test(line)).length * 2 > lines.length && lines.some((line) => /[.!?]$/.test(line));
};

/**
 * The text under a heading that says "this is the description". The first
 * such heading with a paragraph of prose under it is the one: "Overview" over
 * a block of figures is a heading too, and the remarks are further down under
 * "About this home". Only when no heading has prose under it is a block of
 * short lines taken, and then only one that reads as words.
 */
function descriptionUnderHeading(lines: string[]): Described | undefined {
  let tried = 0;
  let listed: Described | undefined;
  for (let i = 0; i < lines.length && tried < 8; i++) {
    const inline = lines[i].length <= MAX_DESCRIPTION_CHARS + 40 ? lines[i].match(DESCRIPTION_INLINE) : null;
    if (!inline && !DESCRIPTION_HEADINGS.has(withoutColon(lines[i]).toLowerCase())) continue;
    tried++;
    const under = underHeading(lines, i, inline?.[1]);
    if (!under) continue;
    const { prose, ...described } = under;
    if (prose) return described;
    if (!listed && readsAsWords(described.text)) listed = described;
  }
  return listed;
}

/** With no heading to go by: the first long paragraph of plain prose that is not small print. A guess, and it says so. */
function firstProse(lines: string[]): Described | undefined {
  for (const line of lines) {
    if (!looksLikeRemarks(line)) continue;
    return line.length > MAX_DESCRIPTION_CHARS ? { text: line.slice(0, MAX_DESCRIPTION_CHARS), cut: true, unsure: true } : { text: line, unsure: true };
  }
  return undefined;
}

function readTextLines(all: string[], source: FactSource): PageReading {
  // The house's own part of the page: what follows "Similar homes" is other houses.
  const lines = all.slice(0, houseEnd(all));
  const { facts, details, where } = readLines(lines, source);
  // Lines to go by: facts from lines of their own, the description from under its heading, or
  // failing that the first long paragraph.
  if (lines.length >= 5) {
    const description = descriptionUnderHeading(lines) ?? firstProse(lines);
    return { facts, details, description: description ? { ...description, source } : undefined, where };
  }
  // A line or two, or one unbroken run of text. A short line may still be a fact of its own
  // ("Built in 1987"); anything else found in it is loose. A heading with its text under it is
  // still a description; a lone paragraph is not guessed to be one.
  for (const line of lines) {
    const loose = looseFacts(line.slice(0, 20_000), source);
    for (const key of Object.keys(loose) as FactKey[]) facts[key] ??= loose[key];
  }
  const description = descriptionUnderHeading(lines);
  return { facts, details: [], description: description ? { ...description, source } : undefined };
}

/** What a page's visible text says. `text` keeps its line breaks when it has them (a pasted page, pageText). */
export function readText(text: string, source: FactSource = "text"): PageReading {
  return readTextLines(toLines(text), source);
}

// ── the page's own structured data ──────────────────────────────────────────

/** A JSON string value as text: `Wood floors\nthroughout` with its escapes undone. A value cut short may end inside an escape, which is dropped. */
function unJson(raw: string): string | undefined {
  for (const tail of [0, 1, 2, 3, 4, 5]) {
    try {
      const value: unknown = JSON.parse(`"${tail ? raw.slice(0, -tail) : raw}"`);
      return typeof value === "string" ? value : undefined;
    } catch {
      /* try without the last character */
    }
  }
  return undefined;
}

/** A description as the page's data carries it, as plain text: entities read, markup gone, its own line breaks kept. */
function plainDescription(raw: string): string {
  return decodeEntities(raw.replace(/<br\b[^<>]{0,20}>|<\/p\s{0,4}>/gi, "\n").replace(/<[^<>]{0,200}>/g, " "))
    .split("\n")
    .map((line) => line.replace(/[ \t\r]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Letters and digits only, lower-cased: how two copies of the same text are compared whatever their spacing and punctuation. */
const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** What a JSON-LD node has to be for its description to be the house's, not the site's, the agent's or the open house's. */
const LISTING_TYPES = new Set(["realestatelisting", "singlefamilyresidence", "house", "residence", "apartment", "accommodation", "product"]);

function descriptionFromJsonLd(blocks: unknown[]): string | undefined {
  for (const block of blocks) {
    let found: string | undefined;
    const walk = (node: unknown, depth: number) => {
      if (found !== undefined || depth > 12 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.slice(0, 200).forEach((n) => walk(n, depth + 1));
      const obj = node as Record<string, unknown>;
      const types = (Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]]).filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
      if (typeof obj.description === "string" && obj.description.trim().length >= 40 && types.some((t) => LISTING_TYPES.has(t))) {
        found = obj.description;
        return;
      }
      for (const value of Object.values(obj).slice(0, 200)) if (value && typeof value === "object") walk(value, depth + 1);
    };
    walk(block, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Keys that hold a listing's remarks and nothing else. "description" is not one: a page has dozens (the cookie notice, the agent, each school). */
const REMARK_KEYS = "publicRemarks|marketingRemarks|listingRemarks|remarks|homeDescription|propertyDescription|listingDescription";
const MAX_JSON_CANDIDATES = 60;

/**
 * The description the page's shipped data carries, when one can be told
 * apart from every other string called "description" on the page.
 *
 * When the text has the description under its heading (`written`), only a
 * string that begins with words found there is the same description: the
 * page's data may hold it in full where the page shows it cut short behind
 * "Show more". Without one: the description of a JSON-LD node that is the
 * listing or the house; else a field that only ever holds remarks; else a
 * "description" the page also shows, when there is just one such. The
 * longest string on the page is not a rule: it is usually the cookie notice.
 */
function descriptionFromData(html: string, visible: string, written: Described | undefined, ld: unknown[]): Described | undefined {
  const candidates: { text: string; cut: boolean; remarks: boolean }[] = [];
  // Each character of the value is taken by exactly one branch, so the pattern cannot backtrack into itself.
  const pattern = new RegExp(`"(description|${REMARK_KEYS})"\\s{0,2}:\\s{0,2}"((?:[^"\\\\]|\\\\.){40,${MAX_DESCRIPTION_CHARS}})("?)`, "g");
  let seen = 0;
  for (const m of html.matchAll(pattern)) {
    if (++seen > MAX_JSON_CANDIDATES) break;
    const raw = unJson(m[2]);
    const text = raw === undefined ? "" : plainDescription(raw);
    if (text.length < 40 || NOT_ABOUT_THE_HOUSE.test(text) || OPENS_LIKE_SMALL_PRINT.test(text.slice(0, 100))) continue;
    candidates.push({ text, cut: m[3] !== '"', remarks: m[1] !== "description" });
  }
  const described = (c: { text: string; cut: boolean }): Described => (c.cut || c.text.length > MAX_DESCRIPTION_CHARS ? { text: c.text.slice(0, MAX_DESCRIPTION_CHARS), cut: true } : { text: c.text });
  const longest = (list: typeof candidates) => list.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  const startsIn = (where: string) => (c: { text: string }) => where.includes(bare(c.text).slice(0, 60));

  if (written && !written.unsure) {
    const same = candidates.filter(startsIn(bare(written.text)));
    return same.length ? described(longest(same)) : undefined;
  }

  const linked = descriptionFromJsonLd(ld);
  if (linked) return described({ text: plainDescription(linked), cut: false });

  const remarks = candidates.filter((c) => c.remarks);
  if (remarks.length && remarks.every((c) => bare(c.text) === bare(remarks[0].text))) return described(remarks[0]);

  const shown = bare(visible);
  const onPage = shown.length >= 40 ? candidates.filter(startsIn(shown)) : [];
  if (onPage.length && onPage.every((c) => bare(c.text).slice(0, 60) === bare(onPage[0].text).slice(0, 60))) return described(longest(onPage));
  return undefined;
}

type JsonRead = (value: string, quoted: boolean) => number | string | undefined;

const jsonNumber: JsonRead = (v) => {
  const n = Number(v.replace(/,/g, "").replace(/ ?(?:sq\.? ?ft|sqft|square feet)\.?$/i, ""));
  return v.trim() && Number.isFinite(n) ? n : undefined;
};
const jsonWords: JsonRead = (v, quoted) => (quoted && /[A-Za-z]/.test(v) ? v.replace(/_/g, " ").toLowerCase() : undefined);

/** The keys the big portals' own data uses for a fact. */
const JSON_FACTS: [FactKey, string[], JsonRead][] = [
  ["yearBuilt", ["yearBuilt"], jsonNumber],
  ["lotSqft", ["lotSize", "lotSizeSquareFeet", "lotSquareFeet"], (v) => {
    const m = v.match(new RegExp(`^(${MEASURE}) ?(${UNIT})?\\.?$`, "i"));
    return m ? lotSqft(m[1], m[2] ?? "sqft") : undefined;
  }],
  ["sqft", ["livingArea", "livingAreaValue", "squareFootage"], jsonNumber],
  ["beds", ["bedrooms", "numberOfBedrooms"], jsonNumber],
  ["baths", ["bathrooms", "numberOfBathroomsTotal"], jsonNumber],
  ["daysOnMarket", ["daysOnZillow", "daysOnMarket"], jsonNumber],
  ["lat", ["latitude"], jsonNumber],
  ["lng", ["longitude"], jsonNumber],
  ["hoaMonthly", ["monthlyHoaFee"], jsonNumber],
  ["taxAnnual", ["taxAnnualAmount"], jsonNumber],
  ["propertyType", ["homeType", "propertyTypeDimension", "propertySubType"], jsonWords],
  ["status", ["homeStatus", "listingStatus"], jsonWords],
  ["mlsId", ["mlsId", "mlsid", "mlsNumber"], (v) => mlsNumber(v) && (/^[A-Za-z0-9-]{4,15}$/.test(v) ? v : undefined)],
];
const JSON_KEY = new Map<string, [FactKey, JsonRead]>(JSON_FACTS.flatMap(([key, names, read]) => names.map((name): [string, [FactKey, JsonRead]] => [name, [key, read]])));
const MAX_JSON_FACT_MENTIONS = 4_000;

/**
 * Facts from the JSON a page ships with, whether it stands in the page as it
 * is or inside a string (`\"yearBuilt\":1987`). One pass for all of them. A
 * listing page carries the same keys for the homes it suggests further down,
 * so a fact is kept only when every mention of it on the page agrees.
 */
function factsFromJson(html: string): ListingFacts {
  const found = new Map<FactKey, { value: number | string; split: boolean }>();
  const note = (key: FactKey, value: number | string | undefined) => {
    if (value === undefined) return;
    const first = found.get(key);
    if (!first) found.set(key, { value, split: false });
    else if (!agree(key, value, first.value)) first.split = true;
  };
  const names = [...JSON_KEY.keys(), "lotAreaValue"].join("|");
  const pattern = new RegExp(`\\\\?"(${names})\\\\?"\\s{0,2}:\\s{0,2}(?:\\\\?"([^"\\\\]{0,60})\\\\?"|(-?\\d{1,12}(?:\\.\\d{1,8})?)(?![\\d.]))`, "g");
  let mentions = 0;
  for (const m of html.matchAll(pattern)) {
    // More mentions than were looked at: "every mention agrees" cannot be said of this page, so nothing is.
    if (++mentions > MAX_JSON_FACT_MENTIONS) return {};
    const quoted = m[2] !== undefined;
    const value = (m[2] ?? m[3]).trim();
    if (m[1] === "lotAreaValue") {
      // "lotAreaValue":0.25,"lotAreaUnits":"Acres": a number and, beside it, what it is counted in. Alone it says nothing.
      const at = m.index ?? 0;
      const unit = html.slice(at + m[0].length, at + m[0].length + 60).match(/^\s{0,2},\s{0,2}\\?"lotAreaUnits?\\?"\s{0,2}:\s{0,2}\\?"([A-Za-z. ]{2,14})\\?"/)?.[1] ?? html.slice(Math.max(0, at - 60), at).match(/\\?"lotAreaUnits?\\?"\s{0,2}:\s{0,2}\\?"([A-Za-z. ]{2,14})\\?"\s{0,2},\s{0,2}$/)?.[1];
      if (unit && new RegExp(`^${UNIT}\\.?$`, "i").test(unit.trim())) note("lotSqft", lotSqft(value, unit.trim()));
      continue;
    }
    const [key, read] = JSON_KEY.get(m[1])!;
    note(key, read(value, quoted));
  }
  const facts: ListingFacts = {};
  for (const [key, one] of found) {
    if (one.split) continue;
    const fact = saneFact(key, { value: one.value, source: "data" });
    if (fact) facts[key] = fact;
  }
  return facts;
}

/**
 * Everything a page gives up beyond the link preview: from the data it ships
 * with (`html`), and from its visible text (`text` if the caller has it with
 * its line breaks, as a pasted page does; worked out from the HTML otherwise).
 * `ld` is the page's JSON-LD if the caller has already parsed it.
 */
export function readPage(page: { html?: string; text?: string; ld?: unknown[] }): PageReading {
  const html = (page.html ?? "").slice(0, MAX_HTML_CHARS);
  const lines = toLines(page.text?.trim() ? page.text : html ? pageText(html) : "");
  const fromText = readTextLines(lines, "text");
  const data: ListingFacts = html ? factsFromJson(html) : {};
  // What the page states on its own lines comes first. Its data fills in what the text did not
  // say, unless the two disagree about the house: then the data is some other home's.
  const facts: ListingFacts = { ...fromText.facts };
  if (!contradicts(data, fromText.facts)) for (const key of Object.keys(data) as FactKey[]) facts[key] ??= data[key];

  // The description: under its heading in the text; the page's data when it carries the same
  // words in full; a guess at the first paragraph only when neither is there.
  const written = fromText.description;
  const shipped = html ? descriptionFromData(html, lines.join("\n"), written, page.ld ?? jsonLd(html)) : undefined;
  const description: ListingDescription | undefined =
    shipped && (!written || written.unsure || shipped.text.length >= written.text.length * 0.9) ? { ...shipped, source: "data" } : written;
  return { facts, details: fromText.details, description, data, where: fromText.where };
}

/**
 * Do these two readings say different things about the house's size, rooms
 * or year? A page's data that does is about another home (the similar-homes
 * widget), and none of it is believed.
 */
export function contradicts(data: ListingFacts | undefined, known: ListingFacts | undefined): boolean {
  return (["beds", "baths", "sqft", "yearBuilt"] as const).some((key) => {
    const a = factNumber(data, key);
    const b = factNumber(known, key);
    return a !== undefined && b !== undefined && a !== b;
  });
}

/** A reading without what the page's data gave. */
export function withoutData(facts: ListingFacts): ListingFacts {
  return Object.fromEntries(Object.entries(facts).filter(([, fact]) => fact.source !== "data")) as ListingFacts;
}

/** The first reading wins, key by key: pass the most believable first. A loose reading gives way to any that is not. */
export function mergeFacts(...sets: (ListingFacts | undefined)[]): ListingFacts {
  const out: ListingFacts = {};
  for (const set of sets) {
    for (const key of Object.keys(set ?? {}) as FactKey[]) {
      const fact = set![key];
      if (fact && (!out[key] || (out[key]!.loose && !fact.loose))) out[key] = fact;
    }
  }
  return out;
}

export const SOURCE_WORDS: Record<FactSource, string> = { data: "the page's own data", text: "the page's text", meta: "the page's summary", link: "the link" };
