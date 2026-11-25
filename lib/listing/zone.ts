import { streetLine } from "./address";

/**
 * The part of a listing page's text that is about its own house.
 *
 * A listing page goes on to show other houses: "Similar homes", "Nearby
 * homes", the agent's other listings. Their prices, rooms and addresses are
 * theirs, and a reader that takes the page as one text reads them as this
 * house's. So everything read about the house is read from the lines before
 * the page turns to other houses.
 *
 * Where that turn is, is told by another home, never by words alone. The
 * words "Similar homes" also stand in a page's menu and in the tabs under
 * its price, and "Other listings by this agent" in its header card, where
 * what follows is the house itself. Another home is a card: a price the page
 * has not given before, by itself on its line, with an address the page has
 * not given before beside it (on the line above, or right under its rooms;
 * a whole address, or only its street). The house's part ends
 *
 *   - at a heading that names other houses, on a line of its own, when such
 *     a card follows within a few lines; or a new price with bedrooms under
 *     it stands right under the heading; or, once the house has been
 *     described, a card written on one line. In each case only after the
 *     page has begun on its own house (given its price, or its rooms and its
 *     address): tabs at the top of a page end nothing;
 *   - under any heading or none ("Keep exploring"), at such a card that also
 *     has bedrooms right under its price, once the page has given its own
 *     price and rooms and gone on to describe the house.
 *
 * A price with rooms under it and no new address is the house itself: its
 * own price box under its remarks on a two-column page, an estimate with the
 * house's rooms repeated under it.
 *
 * The fact reader and the headline reader share this.
 */

/** A heading over other houses, on a line of its own. Not "New listing", "New construction home" or "Other listings by this agent" in a header card: those say something about this house, or stand before it. */
const OTHER_HOMES =
  /^(?:(?:similar|nearby|comparable|recommended|suggested)(?: similar| nearby| new| recently sold)? (?:homes|houses|listings|properties|sales)(?: [a-z ,]{0,30})?|homes (?:for you|nearby|like this(?: one)?)|(?:more|other) (?:homes|houses|properties)(?: [a-z ,]{0,30})?|other listings(?: [a-z ,]{0,30})?|you (?:may|might) also like|people also viewed|recently sold homes(?: [a-z ,]{0,20})?)$/i;

const BEDS_LINE = /\b\d{1,2} ?(?:bd|bds|beds?|bedrooms?|br)\b|^(?:beds?|bedrooms?)\b/i;
/**
 * The way a page gives its own money: an amount at the start of a short
 * line, or behind a word or three ("Price:", "Listed for", "Sold for",
 * "Zestimate®:"). Not "Get pre-approved for up to $600,000 today".
 */
const PRICED = /^(?:[A-Za-z®.]+:? ){0,3}\$ ?(?:\d{2,3},\d{3}|\d,\d{3},\d{3}|\d{5,7}(?!\d)|\d[\d.]{0,5} ?[KkMm]\b)/;

/** An amount of ten thousand dollars or more, anywhere on a line. */
const AMOUNT = /\$ ?(\d{1,3}(?:,\d{3}){1,2}|\d{5,8})(?!\d|,\d{3})/g;
/**
 * A card's price: alone on its line, or behind the word "price". Not "Sale
 * price" or "Sold price": in a table of a house's own facts that is what it
 * last sold for.
 */
const OWN_PRICE = /^((?:list(?:ing)? |asking )?price:? ?)?\$ ?(\d{2,3},\d{3}|\d,\d{3},\d{3})\+?$/i;
/** A card's bedrooms, the number first... */
const CARD_BEDS = /^\d{1,2} ?(?:bd|bds|beds?|bedrooms?|br)\b/i;
/** ...or behind their label, the way a card that writes "Price: $489,000" goes on. */
const CARD_BEDS_LABELLED = /^(?:beds?|bedrooms?):? ?\d{1,2}\b/i;
const BEDS_WORD = /^(?:bd|bds|beds?|bedrooms?|br)$/i;
/** A line of a card's rooms and nothing else: "3 bd 2 ba 1,480 sqft", "3", "bd", "Beds: 3", "1,480 sqft". */
const ROOMS_LINE =
  /^(?:\d{1,2}(?:\.\d)?|\d{1,2},\d{3}|\d{3,5})$|^(?:bd|bds|beds?|bedrooms?|br|ba|baths?|bathrooms?|sq\.? ?ft\.?|sqft|sf|square feet)$|^\d[\d,.]* ?(?:bd|bds|beds?|bedrooms?|br|ba|baths?|bathrooms?|full baths?|half baths?|sq\.? ?ft\.?|sqft|sf|square f(?:ee|oo)t|acres?)\b|^(?:beds?|bedrooms?|baths?|bathrooms?|sq\.? ?ft\.?|sqft|square feet|living area):? ?\d/i;
/** A line that ends in a city, a state and a zip: an address, or the city line of one. */
const ADDRESS_END = /, ?[A-Z]{2} \d{5}(?:-\d{4})?$/;
/** The same without the zip, behind a house number: "9102 198th St E, Graham, WA". */
const ADDRESS_NO_ZIP = /^[NSEW]?\d{1,6}[A-Za-z]? .{3,60}, ?[A-Z][A-Za-z .'-]{1,39}, ?[A-Z]{2}$/;
/** How far into the house's own part a card of another home can be told by its shape alone, when no paragraph came first. */
const LINES_OF_ITS_OWN = 15;
/** A line the house's own price or rooms are given on is a short one: a sentence of the remarks that names a price or a bedroom is not it. */
const SHORT_LINE = 80;

const amountOf = (raw: string) => Number(raw.replace(/,/g, ""));
/** A city by itself on its line: the street is the line above it. */
const cityAlone = (line: string) => ADDRESS_END.test(line) && !/\d/.test(line.replace(ADDRESS_END, ""));
/** What a street is known by: its number and the first word after it. */
const streetKey = (text: string) => {
  const m = text.match(/^([NSEW]?\d{1,6}[A-Za-z]?(?:-\d{1,5})?) (\S+)/);
  return (m ? `${m[1]} ${m[2].replace(/,$/, "")}` : text).toLowerCase();
};

/**
 * The address line `j` gives, known by its street: a whole address, a city
 * under its street, or a street by itself ("9102 198th St E"). Undefined
 * when the line is none of these.
 */
function addressOn(lines: string[], j: number): string | undefined {
  const line = lines[j];
  if (line === undefined || line.length > 120) return undefined;
  if (ADDRESS_END.test(line)) return streetKey(cityAlone(line) ? (lines[j - 1] ?? line) : line);
  return ADDRESS_NO_ZIP.test(line) || streetLine(line) ? streetKey(line) : undefined;
}

/**
 * The price on line `i` is a card's: that home's bedrooms follow within four
 * lines, before any other price, written the way the price is. A bare amount
 * with "Bedrooms: 4" under it is an estimate standing over the house's own
 * table of facts.
 */
function bedsFollow(lines: string[], i: number, labelled: boolean): boolean {
  for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
    const line = lines[j];
    if (line.length > 120 || OWN_PRICE.test(line)) return false;
    if (CARD_BEDS.test(line) || (labelled && CARD_BEDS_LABELLED.test(line))) return true;
    if (/^\d{1,2}$/.test(line) && j + 1 < lines.length && BEDS_WORD.test(lines[j + 1])) return true;
  }
  return false;
}

/**
 * Where the card whose price is on line `i` starts, if an address the page
 * has not given before stands beside it: on the line above its price (a card
 * that leads with its address), or right under its rooms, perhaps after one
 * line of status ("House for sale"). An address the page has given before is
 * the house's own, and an address further off is somebody else's.
 * `addresses`: the addresses of the lines before `i`, each with the line it
 * was first on.
 */
function cardStart(lines: string[], i: number, addresses: Map<string, number>): number | undefined {
  const above = addressOn(lines, i - 1);
  const first = above === undefined ? undefined : addresses.get(above);
  if (first !== undefined && first >= i - 2) return first;
  let j = i + 1;
  while (j < lines.length && j <= i + 7 && lines[j].length <= 60 && ROOMS_LINE.test(lines[j])) j++;
  for (let k = j; k <= j + 1 && k < lines.length; k++) {
    const under = addressOn(lines, k);
    if (under !== undefined) return addresses.has(under) ? undefined : i;
  }
  return undefined;
}

/** A paragraph: long, or sentences (a full stop and then a capital, or one at its end). "Est. payment" in a headline is neither. */
export const isParagraph = (line: string) => line.length > 400 || (line.length > 100 && /[a-z]{3}[.!?](?: [A-Z]|$)/.test(line));

/**
 * How many of these lines are about the page's own house: the index of the
 * line where the page turns to other houses, or all of them.
 *
 * `lines`: the lines that have something on them, in order.
 */
export function houseEnd(lines: string[]): number {
  /** The amounts the page has given so far, and whether it has given its own the way a page does. */
  const given = new Set<number>();
  let priced = false;
  /** The addresses it has given, each with the line it was first on. */
  const addresses = new Map<string, number>();
  /** The short line the house's bedrooms were first said on. */
  let roomsAt = -1;
  let prose = false;
  /** The price of another home's card on line `j`: one the page has not given, by itself on its line, with a new address beside it. Where the card starts. */
  const card = (j: number): number | undefined => {
    const own = lines[j].length <= 40 ? OWN_PRICE.exec(lines[j]) : null;
    return own && !given.has(amountOf(own[2])) ? cardStart(lines, j, addresses) : undefined;
  };
  /** A card written on one line: a price the page has not given and that home's bedrooms, the line starting with the price or with a house number. */
  const cardOnOneLine = (line: string) => {
    if (line.length > 160 || !/^(?:\$ ?\d|[NSEW]?\d{1,6}[A-Za-z]? [A-Za-z0-9])/.test(line) || !/\b\d{1,2} ?(?:bd|bds|beds?|bedrooms?|br)\b/i.test(line)) return false;
    for (const m of line.matchAll(AMOUNT)) if (!given.has(amountOf(m[1]))) return true;
    return false;
  };
  /**
   * What stands under a heading over other homes: a card within a few lines,
   * or once the house has been described a card on one line, when the page
   * has begun on its own house; or right under the heading a new price with
   * bedrooms under it, when the page has given its own price.
   */
  const homesFollow = (i: number, described: boolean) => {
    if (priced || (roomsAt >= 0 && addresses.size > 0)) {
      for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
        if (card(j) !== undefined || (described && cardOnOneLine(lines[j]))) return true;
      }
    }
    const next = lines[i + 1] ?? "";
    const own = priced && next.length <= 40 ? OWN_PRICE.exec(next) : null;
    return Boolean(own && !given.has(amountOf(own[2])) && bedsFollow(lines, i + 1, Boolean(own[1])));
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const described = roomsAt >= 0 && priced && (prose || i - roomsAt >= LINES_OF_ITS_OWN);
    if (line.length <= 60 && OTHER_HOMES.test(line) && homesFollow(i, described)) return i;
    if (described) {
      const start = card(i);
      if (start !== undefined && bedsFollow(lines, i, /^[a-z]/i.test(line))) return start;
    }
    if (line.length > 400) {
      prose = true;
      continue;
    }
    for (const m of line.matchAll(AMOUNT)) given.add(amountOf(m[1]));
    if (!priced && line.length <= SHORT_LINE && PRICED.test(line)) priced = true;
    const address = addressOn(lines, i);
    if (address !== undefined && !addresses.has(address)) addresses.set(address, i);
    if (roomsAt < 0 && line.length <= SHORT_LINE && BEDS_LINE.test(line)) roomsAt = i;
    if (!prose && isParagraph(line)) prose = true;
  }
  return lines.length;
}
