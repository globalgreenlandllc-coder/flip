/**
 * Is the record a data provider answered with the record of the house that
 * was asked about? And: under what name is an answer kept, so that the same
 * house written two ways is asked about once and two houses never share an
 * answer?
 *
 * A provider that places addresses on a map can answer with another house,
 * so an answer is not taken on trust. Nor can it be checked letter by
 * letter: the listing says "13013 224th Street East", the record "13013
 * 224th St E"; one says "Mount Baker Hwy" and the other "Mt Baker Hwy". So
 * both are taken apart the same way and compared part by part:
 *
 *   number   must be the same ("123" is not "123 1/2", "1301" not "13013",
 *            "500-4" not "5004")
 *   unit     must be the same unit, or absent on both sides. A unit is what
 *            follows "#", "Apt", "Unit" and the like, whatever it is called
 *            ("4", "12-B", "PH1", "A-1"), and any part of the address
 *            between the street and the city ("Penthouse", "Rear"). A
 *            building, a floor or a room is not a unit of the same number
 *   name     the street's own name must be the same ("N St" is not "North St")
 *   kind     "St", "Ave", "St Ct": the same, or the one kind left out on one
 *            side ("224th St E" is not "224th St Ct E", nor "224th Ave E")
 *   compass  the compass words, before the name or after it: the same, or
 *            none on one side ("100 N Main St" is not "100 Main St S")
 *   place    the same zip code; failing a zip on one side, the same city
 *            (and never two states). With neither to go by, it is not known
 *            to be the house.
 *
 * Two addresses written the same way, punctuation and capitals aside, are
 * the same without any of that: whatever form an address takes ("N1234
 * County Rd X", "One Main St"), it matches itself.
 *
 * A page often gives an address in two pieces, and it arrives with no comma
 * between the street and the city: "1500 S 336th St Federal Way, WA 98003".
 * Nothing in such a line says where the street ends ("Way" is a kind of
 * street), so the record's own city is looked for at its end. Where the
 * line names another city for the same zip code (a post office serves more
 * than one), the line must begin with the record's whole street, kind and
 * compass words and all, and go on with one word that can only be a city's
 * name: a city of two words ("South Hill", "Des Moines") is not found that
 * way, and its house is turned away. With its comma in place, a line is
 * read as the comma says.
 *
 * Pure, with nothing imported. It errs toward "not this house": a wrong
 * record would put another house's facts and comps under a real result.
 */

const COMPASS: Record<string, string> = {
  n: "n", s: "s", e: "e", w: "w", ne: "ne", nw: "nw", se: "se", sw: "sw", north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  // Pierce County's own, on the Key Peninsula: "Key Peninsula Hwy KPN". Compass points of their own, the same as no other.
  kpn: "kpn", kps: "kps",
};

/** Kinds of street, each under one spelling. */
const KIND: Record<string, string> = {
  st: "st", street: "st", ave: "ave", av: "ave", avenue: "ave", rd: "rd", road: "rd", dr: "dr", drive: "dr", ln: "ln", lane: "ln", ct: "ct", court: "ct", pl: "pl", place: "pl",
  way: "way", wy: "way", blvd: "blvd", boulevard: "blvd", cir: "cir", circle: "cir", ter: "ter", terrace: "ter", pkwy: "pkwy", parkway: "pkwy", hwy: "hwy", highway: "hwy",
  trl: "trl", trail: "trl", loop: "loop", lp: "loop", aly: "aly", alley: "aly", xing: "xing", crossing: "xing", sq: "sq", square: "sq", pt: "pt", point: "pt",
  cv: "cv", cove: "cv", run: "run", pass: "pass", path: "path", row: "row", walk: "walk", bnd: "bnd", bend: "bnd", rdg: "rdg", ridge: "rdg", vw: "vw", view: "vw",
  hts: "hts", heights: "hts", grv: "grv", grove: "grv", gln: "gln", glen: "gln", crk: "crk", creek: "crk", est: "est", estates: "est", ext: "ext", extension: "ext",
};

/** Kinds of street that are a street's whole name as often as its ending: "NE Ridge", "S Point", "View Ridge Dr". Standing alone beside a compass word, such a word is the name. */
const NAME_LIKE_KIND = new Set(["xing", "sq", "pt", "cv", "run", "pass", "path", "row", "walk", "bnd", "rdg", "vw", "hts", "grv", "gln", "crk", "est", "ext"]);

/**
 * Words of a street's name that are written two ways, each under one of them.
 * Four keep the short one, which is how they are met as often as not, and one
 * of which ("St") no rule tells from "Street": Mt, St, Ft, Pt. The rest keep
 * the long one, so that a word a record shortens is the word a listing writes
 * out, and a name written as two words is still the name written as one:
 * "Lk Shore Dr", "Lake Shore Dr" and "Lakeshore Dr" are one street.
 */
const NAME_WORD: Record<string, string> = {
  mount: "mt", saint: "st", fort: "ft", point: "pt", jr: "junior",
  mtn: "mountain", lk: "lake", lndg: "landing", vis: "vista", ctr: "center", hbr: "harbor", mdw: "meadow", mdws: "meadows", vly: "valley", vlg: "village",
  spg: "spring", spgs: "springs", hl: "hill", hls: "hills", plz: "plaza", jct: "junction", smt: "summit", shr: "shore", shrs: "shores", gdn: "garden", gdns: "gardens",
  frst: "forest", crst: "crest", bch: "beach", blf: "bluff", riv: "river", orch: "orchard", rnch: "ranch", cyn: "canyon", holw: "hollow", knl: "knoll", sta: "station",
  cor: "corner", cors: "corners", fld: "field", flds: "fields", cmns: "commons", mnr: "manor",
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
  eleventh: "11th", twelfth: "12th", thirteenth: "13th", fourteenth: "14th", fifteenth: "15th", sixteenth: "16th", seventeenth: "17th", eighteenth: "18th", nineteenth: "19th", twentieth: "20th",
};

/** The words a unit's name follows. */
const UNIT_WORD = new Set(["apt", "apartment", "unit", "ste", "suite", "bldg", "building", "lot", "spc", "space", "trlr", "trailer", "slip", "fl", "floor", "rm", "room", "ph", "ofc", "office", "no"]);
/** What stands before the name of something that is not the home itself: "Bldg 4" is not "Apt 4", nor is "Fl 2" or "PH 3" ("ph3", as in "Unit PH3"). */
const UNIT_CLASS: Record<string, string> = { bldg: "bldg", building: "bldg", fl: "fl", floor: "fl", ph: "ph", rm: "rm", room: "rm", ofc: "ofc", office: "ofc" };
/** A unit's name that cannot be a word of a street: one with a digit in it ("4", "12-b", "ph1", "a-1"), or a single letter. */
const UNIT_NAME = /^(?:[a-z]{0,3}-?\d[a-z0-9-]{0,7}|[a-z])$/;

const STATES = new Set("al ak az ar ca co ct dc de fl ga hi ia id il in ks ky la ma md me mi mn mo ms mt nc nd ne nh nj nm nv ny oh ok or pa ri sc sd tn tx ut va vt wa wi wv wy pr vi gu as mp".split(" "));
/** State codes that are also a kind of street or a compass point (Court, northeast, Way): a state only where a comma stands before them. */
const STATE_OR_STREET = new Set(["ct", "ne", "wy"]);
const isState = (code: string, afterComma: boolean) => STATES.has(code) && (afterComma || !STATE_OR_STREET.has(code));
/** States written out, as they stand after a comma at the end of an address. */
const STATE_NAME: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id",
  illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn",
  mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc",
  "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx",
  utah: "ut", vermont: "vt", virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy", "district of columbia": "dc",
};
const STATE_WRITTEN_OUT = new RegExp(`, (${Object.keys(STATE_NAME).join("|")})(?=$|,? \\d{5}(?:-\\d{4})?$)`);

/** The longest text that is still read as an address. */
const MAX_ADDRESS_CHARS = 300;

export interface TakenApart {
  /** The street number with what belongs to it, as written: "123", "123-45", "n1234", "123 1/2". Empty when the line does not start with one. */
  number: string;
  /** Units named anywhere in the address, each as its own name without hyphens or leading zeros, in order of their letters: ["12b"], ["201", "c"], ["penthouse"]. */
  units: string[];
  /** Compass words before the street's name, short: ["n"], ["ne"]. */
  before: string[];
  /** The street's own name, its words run together, each in its one spelling: "224", "main", "north", "mtbaker", "hwy9", "aved". */
  name: string;
  /** What kind of street, short: ["st"], ["st", "ct"], or none. */
  kinds: string[];
  /** The compass word after the name, short. */
  after: string | null;
  /** The city, its letters run together ("federalway"), and as its words. Null and empty when the address does not say where its city is. */
  city: string | null;
  cityWords: string[];
  state: string | null;
  zip: string | null;
  /** The street line as written, in lower case without punctuation, units taken out. */
  line: string;
  /** The street line's words, number and all, units taken out. With `joined` they are the street and, after it, whatever else the line holds. */
  words: string[];
  /** The address came as one piece, with no comma to say where its street ends, and no city was found at its end. */
  joined: boolean;
}

/** An address in lower case, without accents, typographic marks, doubled spaces or a country after the zip. */
function plain(address: string): string {
  return address
    .replace(/\s*½/g, " 1/2")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    // A comma is followed by a space and not led by one, however it was typed.
    .replace(/ ?, ?/g, ", ")
    .trim()
    .replace(/^(?:, ?)+|(?:, ?)+$/g, "")
    .replace(/,? (?:usa|u\.s\.a\.|united states(?: of america)?)$/, "")
    .replace(/, (?:us|u\.s\.)$/, "")
    // "…, Washington 98032" is "…, WA 98032".
    .replace(STATE_WRITTEN_OUT, (_, name: string) => `, ${STATE_NAME[name]}`);
}

/**
 * A unit's name as it is compared: "12-B" is "12b", "A-1" is "a1", "01" is
 * "1". A hyphen or a slash between a letter and a digit is only a way of
 * writing. One between two digits is part of the name: "11-2" is not "1-12",
 * and neither is "112".
 */
const unitName = (text: string) =>
  text
    .replace(/[^a-z0-9/-]/g, "")
    .replace(/[/-]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/(?<=[a-z])-|-(?=[a-z])/g, "")
    .replace(/^0+(?=\d)/, "");
const letters = (text: string) => text.replace(/[^a-z0-9]/g, "");
/** A piece of an address as its words. A "#" stays, at the head of a word of its own, to mark the unit after it ("Apt#4" is "Apt #4"). */
const wordsOf = (text: string) => text.replace(/['.]/g, "").replace(/#/g, " #").split(/[^a-z0-9#/-]+/).filter(Boolean);
const endsWith = (words: string[], end: string[]) => end.length > 0 && end.length <= words.length && end.every((word, i) => words[words.length - end.length + i] === word);

/** The street's own name from its words: each in its one spelling, run together, a numbered highway under one name. */
function streetName(words: string[]): string {
  // "224th" and "224" are one street; so are "Fourth" and "4th".
  const name = words.map((word) => (NAME_WORD[word] ?? KIND[word] ?? word).replace(/^(\d+)(?:st|nd|rd|th)$/, "$1")).join("");
  // "State Route 9", "State Rt 9", "St Rt 9", "SR 9", "WA-9", "Highway 9", "Hwy 9", "US 2": one road, many spellings.
  return name.replace(/^(?:wa)?(?:state(?:route|rte|rt|hwy|rd)|strt|sr|hwy|route|rte|rt|ushwy|us|wa)(\d+[a-z]?)$/, "hwy$1");
}

/**
 * Takes the units out of a piece's words and gives back the rest. After a
 * "#", whatever follows is a unit. After "Apt", "Unit" and the like, a name
 * with a digit in it or a single letter is one wherever it stands; a name in
 * letters alone ("PH") is one only at the end of the street line, where it
 * cannot be the street's ("1601 Space Center Blvd"). `whole`: the piece is
 * nothing but units ("Bldg C, Unit 201"), and whatever follows such a word is
 * its name.
 */
function takeUnits(words: string[], units: string[], whole: boolean): string[] {
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.startsWith("#")) {
      // "#4", or "# 4". A "#" with nothing after it names nothing.
      const name = word.length > 1 ? word.slice(1) : (words[i + 1] ?? "");
      if (word.length === 1 && words[i + 1] !== undefined) i++;
      if (unitName(name)) units.push(unitName(name));
      continue;
    }
    if (UNIT_WORD.has(word) && words[i + 1] !== undefined) {
      // "Apt 4", "Apt #4", "Apt # 4".
      const marked = words[i + 1].startsWith("#");
      const used = words[i + 1] === "#" ? 2 : 1;
      const name = words[i + 1] === "#" ? (words[i + 2] ?? "") : words[i + 1].replace(/^#/, "");
      const last = i + used === words.length - 1;
      const sure = marked || UNIT_NAME.test(name);
      const atEnd = last && /^[a-z0-9-]+$/.test(name) && !KIND[name] && !COMPASS[name] && (whole || kept.length >= 2);
      if (unitName(name) && (sure || whole || atEnd)) {
        units.push(`${UNIT_CLASS[word] ?? ""}${unitName(name)}`);
        i += used;
        continue;
      }
    }
    kept.push(word);
  }
  return kept;
}

/** A piece of the address that is not street and not city: the unit ("Unit 201"), or a part of the building in words of its own ("Penthouse"). Kept as a unit either way. */
function designated(piece: string, units: string[]): void {
  const left = takeUnits(wordsOf(piece), units, true);
  if (left.length && unitName(left.join(""))) units.push(unitName(left.join("")));
}
const startsLikeUnit = (piece: string) => {
  const first = wordsOf(piece)[0] ?? "";
  return first.startsWith("#") || UNIT_WORD.has(first);
};

interface Street {
  number: string;
  before: string[];
  name: string;
  kinds: string[];
  after: string | null;
  line: string;
}

/** A street line's words (units already taken out) as number, compass words, name and kind. A unit's letter on or after the number goes to `units`. */
function streetOf(lineWords: string[], units: string[]): Street {
  const words = [...lineWords];
  let number = "";
  // "123", "123a" or "123-a" (a unit's letter on the number), "123-45", "n1234"; then perhaps "1/2".
  const first = words[0] ?? "";
  const attached = first.match(/^(\d+)-?([a-z])$/);
  if (attached) {
    number = attached[1];
    units.push(attached[2]);
    words.shift();
  } else if (/^(?:\d+|\d+-\d+|[nsew]\d+)$/.test(first)) {
    number = first;
    words.shift();
  }
  if (number && /^\d\/\d$/.test(words[0] ?? "")) number += ` ${words.shift()}`;
  // A townhouse's letter between the number and the street: "4121 A Whitman Ave N". Not a compass letter, and
  // not when a kind of street follows at once: "4121 A St" is A Street.
  if (number && words.length >= 3 && /^[a-z]$/.test(words[0]) && !COMPASS[words[0]] && !KIND[words[1]]) units.push(words.shift()!);

  const rest = words.map((word) => word.replace(/[/#-]/g, "")).filter(Boolean);
  const line = [number, ...rest].join(" ");
  const before: string[] = [];
  while (rest.length > 1 && COMPASS[rest[0]]) before.push(rest.shift()!);
  let after: string | null = null;
  if (rest.length > 1 && COMPASS[rest[rest.length - 1]]) after = rest.pop()!;
  const kinds: string[] = [];
  while (rest.length > 0 && KIND[rest[rest.length - 1]]) kinds.unshift(rest.pop()!);
  let nameWords = rest;
  // A street has a name. Where what is left has none, the name is one of the words taken for something else:
  // "Court St" is Court Street and "N Ridge Ave" is Ridge Avenue (the first of two kinds is the name), "NE Ridge"
  // is a street called Ridge (a word that names streets more often than it ends them), "E St" is E Street,
  // "E North St" is North Street, "Avenue E" is Avenue E.
  let nameIsCompass = false;
  if (nameWords.length === 0) {
    if (kinds.length > 1 || (kinds.length === 1 && NAME_LIKE_KIND.has(KIND[kinds[0]]) && (before.length > 0 || after !== null))) {
      nameWords = [kinds.shift()!];
    } else if (before.length) {
      nameWords = [before.pop()!];
      nameIsCompass = true;
    } else if (after) {
      nameWords = [...kinds.splice(0), after];
      after = null;
    }
  }
  return {
    number,
    before: before.map((word) => COMPASS[word]),
    // A compass word that is the street's own name keeps its spelling: "N St" and "North St" are two streets.
    name: nameIsCompass ? nameWords.join("") : streetName(nameWords),
    kinds: kinds.map((word) => KIND[word]),
    after: after ? COMPASS[after] : null,
    // The number stays as it was written: "500-4" is not "5004".
    line,
  };
}

/**
 * An address taken apart (see the top of the file). `known`: the record it
 * is being compared with, for an address written without commas, where
 * nothing else says where the street ends and the city begins.
 */
export function takeApart(address: string, known?: Pick<TakenApart, "cityWords" | "state"> | null): TakenApart {
  // An address is a line of text. Anything much longer than one is not an address, and is not read as one.
  let text = address.length > MAX_ADDRESS_CHARS ? "" : plain(address);

  // The zip code, and the state before it: "…, WA 98338", "… WA 98338-4410", "…, WA, 98338". Two letters are a
  // state only if they are one, and "Ct", "NE" and "Wy" only after a comma: "123 Main Ct, 98032" is Main Court.
  let zip: string | null = null;
  let state: string | null = null;
  const tail = text.match(/(,?) ([a-z]{2})\.?,? (\d{5})(?:-\d{4})?$/);
  if (tail && isState(tail[2], tail[1] === ",")) {
    [state, zip] = [tail[2], tail[3]];
    text = text.slice(0, tail.index);
  } else {
    const zipOnly = text.match(/(?:,| )(\d{5})(?:-\d{4})?$/);
    if (zipOnly) {
      zip = zipOnly[1];
      text = text.slice(0, zipOnly.index);
    }
    // A state with no zip code after it: after a comma ("…, Kent, WA"), or after the city in the last of several
    // pieces ("…, Kent WA").
    const stateOnly = text.match(/(,?) ([a-z]{2})\.?,?$/);
    if (stateOnly && isState(stateOnly[2], stateOnly[1] === ",") && (stateOnly[1] === "," || text.slice(0, stateOnly.index).includes(","))) {
      state = stateOnly[2];
      text = text.slice(0, stateOnly.index);
    }
  }

  // The pieces between commas: the street line first, the city last, and between them the unit. A county is none
  // of the three, wherever it stands ("…, Graham, Pierce County, WA 98338").
  const pieces = text.split(",").map((piece) => piece.trim()).filter((piece) => piece && !/(?:^| )county$/.test(piece));
  const units: string[] = [];
  // "Lot 12, 4821 Orchard Loop Rd, …": a unit named before the street.
  while (pieces.length > 1 && startsLikeUnit(pieces[0])) designated(pieces.shift()!, units);
  let city: string | null = null;
  let cityWords: string[] = [];
  let lineWords = wordsOf(pieces[0] ?? "");
  let joined = false;
  // The record's city (and its state, where this address still carries one) is looked for at the end of an address
  // that is a street and a city and no more: one with no comma between them ("1500 S 336th St Federal Way"), or
  // with a comma put inside the city's name ("100 Main St San, Jose"). At least a number and a word of street must
  // be left: "100 Federal Way" is a street, not a number in Federal Way. A comma that stands before the whole of
  // the city says where the street ends, and is believed: "…St SE, North Puyallup" is not a street called
  // "…St SE North" in the record's Puyallup.
  const lastWords = wordsOf(pieces[1] ?? "");
  const streetAndCity = pieces.length <= 2 ? [...lineWords, ...lastWords] : [];
  const ends = known?.cityWords.length && !(pieces.length === 2 && startsLikeUnit(pieces[1])) ? [...(known.state && !state ? [[...known.cityWords, known.state]] : []), known.cityWords] : [];
  const end = ends.find((words) => streetAndCity.length - words.length >= 2 && endsWith(streetAndCity, words) && (pieces.length === 1 || words.length > lastWords.length));
  if (end) {
    lineWords = streetAndCity.slice(0, -end.length);
    [city, cityWords] = [known!.cityWords.join(""), known!.cityWords];
    if (end.length > known!.cityWords.length) state = known!.state;
  } else if (pieces.length >= 2) {
    const last = pieces[pieces.length - 1];
    // "500 Main St, Unit 4" has a unit where the city would be.
    if (startsLikeUnit(last)) designated(last, units);
    else if (letters(last)) [city, cityWords] = [letters(last), wordsOf(last)];
    for (const piece of pieces.slice(1, -1)) designated(piece, units);
  } else if (lineWords.length) {
    // One piece, and nothing known that says where its street ends.
    joined = true;
  }

  const words = takeUnits(lineWords, units, false);
  const street = streetOf(words, units);
  return { ...street, units: units.sort(), city, cityWords, state, zip, words, joined };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);
/** Two lists that do not contradict each other: the same, or one of them empty. */
const agree = (a: string[], b: string[]) => a.length === 0 || b.length === 0 || sameList(a, b);
/**
 * The kinds of two streets, the same or left out on one side: "Meridian E"
 * is "Meridian Ave E". Only one kind may be left out. Where one side gives
 * two ("Mill Creek Rd" is read as Mill, Creek, Road), the first may be half
 * of the street's name, and "100 Mill" is not known to be that street.
 */
const kindsAgree = (a: string[], b: string[]) => sameList(a, b) || (a.length + b.length === 1);
/** A street's compass words, wherever they stand: "N Main St" and "Main St N" are written two ways, "N Main St" and "Main St S" are two streets. */
const compass = (street: Street) => [...street.before, ...(street.after ? [street.after] : [])].sort();

/** The same street and number, by the rules at the top of the file. */
function sameStreet(mine: Street, record: Street): boolean {
  if (!mine.number || mine.number !== record.number) return false;
  if (!mine.name || mine.name !== record.name) return false;
  return kindsAgree(mine.kinds, record.kinds) && agree(compass(mine), compass(record));
}

/**
 * A word after a street that is not a city's name: a part of the lot or of
 * the building ("Rear", "Upper"), or one of the words streets end in that
 * are not in KIND because they also begin names ("Main St Mall", "Park Ave
 * Plaza").
 */
const NOT_A_CITY = new Set([
  ...UNIT_WORD,
  ...["rear", "front", "upper", "lower", "back", "penthouse", "basement", "bsmt", "loft", "garage", "studio", "annex", "cottage", "house"],
  ...["mall", "plaza", "plz", "promenade", "park", "commons", "center", "ctr", "village", "landing", "vista", "gardens", "garden", "manor", "meadows", "meadow", "station", "junction", "hollow", "summit"],
  ...["springs", "spring", "island", "isle", "harbor", "shores", "shore", "beach", "bluff", "bridge", "brook", "canyon", "corner", "corners", "crest", "field", "fields", "forest", "hill", "hills", "lake", "lakes"],
  ...["mill", "mills", "mountain", "orchard", "pines", "port", "prairie", "ranch", "river", "valley", "spur", "bypass", "expressway", "freeway", "turnpike", "pike", "causeway", "oval", "crescent", "curve"],
  ...["dale", "flats", "fork", "forks", "gateway", "green", "haven", "key", "keys", "knoll", "knolls", "lodge", "mission", "overpass", "underpass", "plain", "plains", "rapids", "rest", "stream", "trace", "track"],
  ...["tunnel", "union", "viaduct", "wells", "club", "camp", "cape", "cliff", "cliffs", "course", "divide", "ford", "inlet", "branch", "frontage", "access", "service", "business", "old", "new", "upper", "lower"],
]);

/**
 * A line with no comma in it, under a city the record does not name: does it
 * begin with the record's street? The whole of it, and only it. The number,
 * name, kind and compass words must be the record's own, and the record's
 * street must have an end to it, a kind or a compass word after the name:
 * "100 Main" could go on as "100 Main Line Dr". What follows must be one
 * word, and a word that can only be a city's name: not a number, not a
 * kind of street or a compass word, not a part of a building ("100 Main St
 * Rear"), not one of the words that streets end in ("100 Main St Mall").
 * Two words are not taken: "5300 Lake St Clair Dr SE Lacey" is Lake Saint
 * Clair Drive, not "5300 Lake St" in a city of several words. So a city
 * whose name is two words ("South Hill", "Des Moines") is not found this
 * way, and its house is turned away: better that than another street's
 * house taken.
 *
 * What is left: a street one word longer with no kind of its own ("100
 * Lake St Clair") against a record for "100 Lake St". It takes a service
 * that answers one with the other, a page that leaves out the comma and the
 * city both, and a zip code the two share.
 */
function beginsWithStreet(words: string[], record: Street): boolean {
  if (record.kinds.length === 0 && record.after === null) return false;
  const city = words[words.length - 1] ?? "";
  if (words.length < 3 || city.length < 3 || /[^a-z]/.test(city) || KIND[city] || COMPASS[city] || NOT_A_CITY.has(city)) return false;
  const street = streetOf(words.slice(0, -1), []);
  return Boolean(street.number) && street.number === record.number && Boolean(street.name) && street.name === record.name && sameList(street.kinds, record.kinds) && sameList(street.before, record.before) && street.after === record.after;
}

/**
 * Is `onRecord` the address that was asked for? True only when the two can
 * be told to be the same house (see the top of the file).
 */
export function sameHouseAddress(asked: string, onRecord: string): boolean {
  const record = takeApart(onRecord);
  // A record's address says what city it is in. One that does not is not a record's address.
  if (!record.city) return false;
  const mine = takeApart(asked, record);
  // The same place: by zip code, and where one side gives none, by city. Never two states.
  if (mine.state && record.state && mine.state !== record.state) return false;
  if (mine.zip && record.zip ? mine.zip !== record.zip : !(mine.city && record.city && mine.city === record.city)) return false;
  if (!sameList(mine.units, record.units)) return false;
  // Written the same way, whatever way that is.
  if (mine.line !== "" && mine.line === record.line) return true;
  if (sameStreet(mine, record)) return true;
  return mine.joined && mine.zip !== null && beginsWithStreet(mine.words, record);
}

/**
 * What an answer about an address is kept under. The same house written two
 * ways ("Rd." or "Road", "North Main" or "N Main", a comma more or less, the
 * zip with its four extra digits) has one key; two houses that
 * sameHouseAddress tells apart never do.
 */
export function addressKey(address: string): string {
  const a = takeApart(address);
  if (!a.number || !a.name) return `as-written ${plain(address.slice(0, MAX_ADDRESS_CHARS)).replace(/[^a-z0-9]+/g, " ").trim()}`;
  return [a.number, a.units.join("+"), a.before.join(" "), a.name, a.kinds.join(" "), a.after ?? "", a.zip ?? [a.city ?? "", a.state ?? ""].join(" ").trim()].join("|");
}
