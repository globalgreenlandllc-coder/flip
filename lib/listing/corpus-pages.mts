/**
 * Generated listing pages with known answers: the parts, and how they go
 * together. Test support for corpus.test.mts; nothing in the app imports it.
 *
 * A page is put together from small parts in every combination: where the
 * price, the address and the rooms stand (also with the remarks before the
 * price box, the way a two-column page reads), how each is written, what a
 * site puts around its price (a lender's banner, an old price, an office's
 * address), and how it shows other homes underneath. The parts are written
 * by hand in the way listing sites lay their pages out. No site was read to
 * make them.
 */

export interface House {
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  address: string;
  year: number;
}

export const HOUSES: House[] = [
  { price: 549_000, beds: 4, baths: 3, sqft: 2340, address: "13013 224th St E, Graham, WA 98338", year: 1987 },
  // Small and cheap: every other amount on its page is larger than its price.
  { price: 189_500, beds: 2, baths: 1, sqft: 850, address: "712 Day Lily Ln, Lacey, WA 98503", year: 1948 },
  // Seven figures, a half bath, a grid address.
  { price: 1_250_000, beds: 5, baths: 3.5, sqft: 4120, address: "1234 E 4500 S, Salt Lake City, UT 84117", year: 2004 },
  // The same beds and baths as the home on the card below it, and another size.
  { price: 324_900, beds: 3, baths: 2, sqft: 1612, address: "45200 12 Mile Rd, Novi, MI 48377", year: 1962 },
];

/** plain: remarks and a few facts. rich: a full facts section, a payment calculator, price and tax history. valued: an estimate that repeats the house's rooms, between the remarks and the facts. */
export const BODIES = ["plain", "rich", "valued"] as const;
export type Body = (typeof BODIES)[number];

/** The last is a fact no page here states of its house: what is read for it was another home's. */
export const FIELDS = ["price", "beds", "baths", "sqft", "address", "yearBuilt", "daysOnMarket"] as const;
export type Field = (typeof FIELDS)[number];

export interface Page {
  name: string;
  lines: string[];
  /** How the page gives the living area with the rooms: beside them even in one run of words, only on a line of its own, or not at all. */
  size: "beside" | "line" | "none";
}

const count = (x: number) => x.toLocaleString("en-US");
const dollars = (x: number) => `$${count(x)}`;
const rounded = (x: number, to: number) => Math.round(x / to) * to;

const REMARKS =
  "Updated rambler on a quiet street with a new roof and furnace. The detached shop was built in 2019 and has 1,200 sqft with 220 power. There is also a 1 bedroom ADU with 1 bath over the garage, and the seller offers a $10,000 credit toward closing. Sold as-is.";
const THEIRS = "9102 198th St E, Graham, WA 98338";
const CARD = ["$612,000", "3 bd 2 ba 1,480 sqft", THEIRS];
const OFFICE = ["100 Main St", "Tacoma, WA 98402"];
export const LINK = "https://www.windfall.example/listing/2301234";

type Block = "price" | "address" | "rooms" | "remarks" | "status";

function parts(house: House, body: Body) {
  const size = count(house.sqft);
  const beds = `${house.beds} ${house.beds === 1 ? "bed" : "beds"}`;
  const baths = `${house.baths} ${house.baths === 1 ? "bath" : "baths"}`;
  const payment = `${dollars(Math.round(house.price * 0.0063))}/mo`;
  const [street, city, stateZip] = house.address.split(", ");
  const facts = [`Year built: ${house.year}`, "Lot size: 7,405 sqft", "Sewer: Septic Tank", "Listing terms: Cash, Conventional"];
  return {
    /** The address on one line, the street over its city, or written the post office's way, without the comma before the state. */
    address: {
      "one line": [house.address],
      "street over city": [street, `${city}, ${stateZip}`],
      "no comma before the state": [`${street}, ${city} ${stateZip}`],
    } as Record<string, string[]>,
    /** The order the page gives things in. The last two are a two-column page (its remarks come before its price box) and a page that puts a few status lines between the rooms and the price. */
    layout: {
      "price, address, rooms": ["price", "address", "rooms", "remarks"],
      "address, price, rooms": ["address", "price", "rooms", "remarks"],
      "price, rooms, address": ["price", "rooms", "address", "remarks"],
      "address, rooms, price": ["address", "rooms", "price", "remarks"],
      "address, remarks, then the price box": ["address", "remarks", "price", "rooms"],
      "address, rooms, status lines, price": ["address", "rooms", "status", "price", "remarks"],
    } as Record<string, Block[]>,
    rooms: {
      "one line": { lines: [`${house.beds} bd ${house.baths} ba ${size} sqft`], size: "beside" },
      "three lines": { lines: [beds, baths, `${size} sqft`], size: "beside" },
      "numbers over labels": { lines: [String(house.beds), "beds", String(house.baths), "baths", size, "sqft"], size: "beside" },
      "labels over numbers": { lines: ["Beds", String(house.beds), "Baths", String(house.baths), "Sq Ft", size], size: "beside" },
      "labels first": { lines: [`Beds: ${house.beds}`, `Baths: ${house.baths}`, `Sq Ft: ${size}`], size: "beside" },
      commas: { lines: [`${beds}, ${baths}, ${size} Square Feet`], size: "beside" },
      bars: { lines: [`${house.beds} BR | ${house.baths} BA | ${size} SF`], size: "beside" },
      "size first": { lines: [`${size} sqft · ${house.beds} bd · ${house.baths} ba`], size: "beside" },
      "a lot between": { lines: [`${house.beds} bd · ${house.baths} ba · 0.17 acres · ${size} sqft`], size: "beside" },
      "the size on a line of its own": { lines: [`${house.beds} BR, ${house.baths} BA`, `Approx. ${size} sq. ft.`], size: "line" },
      "no size": { lines: [`${house.beds} bd ${house.baths} ba`], size: "none" },
    } as Record<string, { lines: string[]; size: Page["size"] }>,
    /** What a site puts on the lines above its price. */
    above: {
      nothing: [],
      buttons: ["Save", "Share", "Hide"],
      "for sale": ["For sale"],
      "price reduced": ["Price reduced $20,000"],
      "cash back": ["Buy with us and get $12,500 back"],
      "photo count": ["1 of 37"],
      "a lender's banner": ["Get pre-approved for up to $600,000 today"],
      "old price": [`Was ${dollars(rounded(house.price * 1.05, 1000))}`],
      "an office's address": ["Windfall Realty", ...OFFICE],
      "an amount in a phrase": ["$40,000 in upgrades since 2023"],
      "price label": ["List price"],
    } as Record<string, string[]>,
    price: {
      alone: dollars(house.price),
      labelled: `Price: ${dollars(house.price)}`,
      "with payment": `${dollars(house.price)} Est. ${payment}`,
      "listed for": `Listed for ${dollars(house.price)}`,
      "with its cut beside it": `${dollars(house.price)} -$20,000`,
      "with the old price beside it": `${dollars(house.price)} ${dollars(rounded(house.price * 1.05, 1000))}`,
    } as Record<string, string>,
    /** ...and on the lines right under it. */
    under: {
      nothing: [],
      "est payment": [`Est. payment: ${payment}`],
      estimate: [`${dollars(rounded(house.price * 1.022, 100))} Zestimate®`],
      "price cut": ["Price cut: $10,000 (11/3)"],
      tabs: ["Overview", "Facts and features", "Similar homes"],
      "agent link": ["Other listings by this agent"],
      credit: ["Seller credit $10,000 toward closing"],
      "the listing office": ["Listed by Windfall Realty", ...OFFICE],
      "the old price": [dollars(rounded(house.price * 1.05, 1000))],
      "an estimate over its label": [dollars(rounded(house.price * 0.966, 100)), "Estimate"],
    } as Record<string, string[]>,
    /** The other homes a page goes on to show. */
    after: {
      nothing: [],
      "similar homes, a card": ["Similar homes", ...CARD],
      "nearby homes, numbers on lines of their own": ["Nearby homes", "$612,000", "3 bd", "2 ba", "1,480 sqft", THEIRS],
      "similar homes, labels first": ["Similar homes", "Price: $489,000", "Beds: 3", "Baths: 2", "Sq Ft: 1,480", THEIRS],
      "homes for you, address first": ["Homes for you", THEIRS, "$612,000", "3 bd 2 ba 1,480 sqft"],
      "a heading the reader does not know": ["Keep exploring", ...CARD],
      "a heading it does not know, numbers on lines": ["Keep exploring", "$612,000", "3 bd", "2 ba", "1,480 sqft", THEIRS],
      "a heading it does not know, labels first": ["Keep exploring", "Price: $489,000", "Beds: 3", "Baths: 2", "Sq Ft: 1,480", THEIRS],
      "a heading it does not know, numbers over labels": ["Keep exploring", "$612,000", "3", "bd", "2", "ba", "1,480", "sqft", THEIRS],
      "a heading it does not know, address first": ["Keep exploring", THEIRS, "$612,000", "3 bd 2 ba 1,480 sqft"],
      "no heading at all": [...CARD, "$515,000", "3 bd 2 ba 1,720 sqft", "22815 131st Ave E, Graham, WA 98338"],
      "similar homes, street first, with what a card adds": ["Similar homes", "9102 198th St E", "$489,000", "3 bd 2 ba 1,480 sqft", "0.25 acres", "3 days on Zillow", "Townhouse", "Built in 2004"],
      "similar homes, a line each": ["Similar homes", "$489,000 · 3 bd 2 ba 1,480 sqft · 9102 198th St E", "$515,000 · 3 bd 2 ba 1,720 sqft · 22815 131st Ave E", "3 days on Zillow"],
      "an office at the foot of the page": ["Visit us", "100 Main St, Tacoma, WA 98402"],
    } as Record<string, string[]>,
    /** What a site puts on the line over its listing's address: its own name, a breadcrumb, who listed it. */
    over: {
      "the site's name": "Windfall Realty",
      "a breadcrumb": "Graham Real Estate",
      "who listed it": "Listed by Windfall Realty",
    } as Record<string, string>,
    remarks: ["What's special", REMARKS],
    status: ["Single family residence", "Active", "MLS #2301234", "Open house Sat 1-3"],
    /** What follows the top of the page and the remarks. */
    rest:
      body === "plain"
        ? ["Facts & features", ...facts]
        : body === "valued"
          ? ["Home value", dollars(rounded(house.price * 1.022, 100)), `${beds} · ${baths} · ${size} sqft`, "Facts & features", ...facts]
          : [
              "Facts & features",
              "Interior",
              "Bedrooms & bathrooms",
              `Bedrooms: ${house.beds}`,
              `Bathrooms: ${house.baths}`,
              `Full bathrooms: ${Math.floor(house.baths)}`,
              ...(house.baths % 1 ? ["1/2 bathrooms: 1"] : []),
              "Primary bedroom",
              "Level: Main",
              "Bedroom 2",
              "Level: Upper",
              "Dimensions: 10 x 12",
              "Bathroom",
              "Features: Double vanity",
              "Heating",
              "Heating features: Forced Air",
              "Interior area",
              `Total interior livable area: ${size} sqft`,
              "Property",
              "Parking",
              "Total spaces: 2",
              "Garage spaces: 2",
              "Lot",
              "Size: 7,405 sqft",
              "Construction",
              `Year built: ${house.year}`,
              "Utilities & green energy",
              "Sewer: Septic Tank",
              "Listing terms: Cash, Conventional",
              "Monthly payment",
              `Principal & interest ${dollars(Math.round(house.price * 0.0051))}`,
              "Property taxes $452",
              "Home insurance $192",
              "HOA fees $0",
              "Price history",
              "Date",
              "Event",
              "Price",
              "11/3/2026",
              "Price change",
              dollars(house.price),
              "-3.5%",
              "9/14/2026",
              "Listed for sale",
              dollars(rounded(house.price * 1.036, 1000)),
              "6/2/2019",
              "Sold",
              dollars(rounded(house.price * 0.73, 1000)),
              "Public tax history",
              "Year",
              "Property taxes",
              "Tax assessment",
              "2025",
              "$5,424",
              dollars(rounded(house.price * 0.91, 1000)),
            ],
    /** What a link preview says: the portal's own sentence, or the start of the remarks. */
    preview: {
      portal: `Windfall has 37 photos of this ${dollars(house.price)} ${beds}, ${baths}, ${size} Square Feet single family home located at ${house.address} built in ${house.year}.`,
      remarks: REMARKS.slice(0, 180),
    },
  };
}

/** Every page for one house and one kind of body: 1,698,312 of them. `every`: only each so-many-th is built, starting with the one numbered `first`. */
export function* pages(house: House, body: Body, every = 1, first = 0): Generator<Page> {
  const p = parts(house, body);
  let n = -first;
  const skip = () => n++ % every !== 0;
  const page = (name: string, layout: Block[], block: Record<Block, string[]>, after: string[], size: Page["size"]): Page => ({
    name,
    lines: ["Buy", "Rent", "Sell", ...layout.flatMap((k) => block[k]), ...p.rest, ...after],
    size,
  });
  for (const [d, address] of Object.entries(p.address))
    for (const [o, layout] of Object.entries(p.layout))
      for (const [r, rooms] of Object.entries(p.rooms))
        for (const [a, above] of Object.entries(p.above))
          for (const [w, price] of Object.entries(p.price))
            for (const [u, under] of Object.entries(p.under))
              for (const [t, after] of Object.entries(p.after)) {
                // "List price" on the line above only makes sense over a bare amount.
                if (a === "price label" && w !== "alone") continue;
                if (skip()) continue;
                // The lines above the price stand above it and the lines under it under it, wherever the price is.
                const block: Record<Block, string[]> = { price: [...above, price, ...under], address, rooms: rooms.lines, remarks: p.remarks, status: p.status };
                yield page(`${o} | address: ${d} | rooms: ${r} | above the price: ${a} | price: ${w} | under it: ${u} | other homes: ${t}`, layout, block, after, rooms.size);
              }
  // A line over the address that names a brokerage, where the address leads the page.
  for (const [d, over] of Object.entries(p.over))
    for (const [o, layout] of Object.entries(p.layout)) {
      if (layout[0] !== "address") continue;
      for (const [r, rooms] of Object.entries(p.rooms))
        for (const w of ["alone", "labelled"])
          for (const u of ["nothing", "the listing office"])
            for (const [t, after] of Object.entries(p.after)) {
              if (skip()) continue;
              const block: Record<Block, string[]> = { price: [p.price[w], ...p.under[u]], address: [over, house.address], rooms: rooms.lines, remarks: p.remarks, status: p.status };
              yield page(`${o} | address: one line, under ${d} | rooms: ${r} | above the price: nothing | price: ${w} | under it: ${u} | other homes: ${t}`, layout, block, after, rooms.size);
            }
    }
}

export const previews = (house: House, body: Body) => parts(house, body).preview;

const asPage = (lines: string[], preview = "") =>
  `<html><head><title>Windfall Realty</title>${preview ? `<meta property="og:description" content="${preview}">` : ""}<meta property="og:image" content="https://cdn.windfall.example/photos/1.jpg"></head><body>${lines.map((l) => `<div>${l.replace(/&/g, "&amp;")}</div>`).join("")}</body></html>`;

/** What a reading has to give for the checks below. */
export interface Reading {
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  address?: string;
  facts?: { yearBuilt?: { value: number | string; loose?: boolean }; daysOnMarket?: { value: number | string; loose?: boolean } };
}

/** The reader's four entrances. */
export interface Reader {
  /** A page copied out of the browser, as text with its line breaks. */
  pasted(text: string): Reading;
  /** What the button on a listing page hands over: one run of words. */
  button(text: string): Reading;
  /** The page as the person's browser fetched it. */
  fetched(url: string, html: string): Reading;
  /** The page as the server fetched it. */
  server(url: string, html: string): Reading;
}

/**
 * Every way a page reaches the reader.
 * `whole`: the reader is also given something that states every headline field, whatever the page leads with (the portal's preview).
 * `run`: the page arrives as one run of words. A fact that stands on a line of its own has no line there, and by the reader's rule gives nothing to count on.
 */
export const WAYS: Record<string, { read: (reader: Reader, page: Page, preview: { portal: string; remarks: string }) => Reading; whole?: boolean; run?: boolean }> = {
  "pasted page": { read: (reader, page) => reader.pasted(page.lines.join("\n")) },
  "the button on a listing page": { read: (reader, page) => reader.button(page.lines.join(" ").replace(/\s+/g, " ").slice(0, 2000)), run: true },
  "the browser's own fetch": { read: (reader, page) => reader.fetched(LINK, asPage(page.lines)) },
  "the server, a portal's preview": { read: (reader, page, preview) => reader.server(LINK, asPage(page.lines, preview.portal)), whole: true },
  "the server, a preview of the remarks": { read: (reader, page, preview) => reader.server(LINK, asPage(page.lines, preview.remarks)) },
};

/**
 * What is wrong with a reading of a page, field by field: `wrong` when it
 * gives something that is not the house's, `missing` when the page states
 * the house's and the reading has nothing.
 */
export function faults(house: House, body: Body, page: Page, way: (typeof WAYS)[string], got: Reading): { field: Field; kind: "wrong" | "missing"; value: unknown }[] {
  const out: { field: Field; kind: "wrong" | "missing"; value: unknown }[] = [];
  for (const field of FIELDS) {
    const fact = field === "yearBuilt" || field === "daysOnMarket" ? got.facts?.[field] : undefined;
    const value = field === "yearBuilt" || field === "daysOnMarket" ? (fact && !fact.loose ? fact.value : undefined) : got[field];
    const truth = field === "yearBuilt" ? house.year : field === "daysOnMarket" ? undefined : house[field];
    if (value === truth) continue;
    // One run of words has no line break to say where the street ends: there the address is the house's with or without that comma.
    if (field === "address" && typeof value === "string" && value.replace(/,/g, "") === house.address.replace(/,/g, "")) continue;
    if (value === undefined) {
      // The size is the house's to give only where something states it: beside the rooms, on a line of its own, in the facts of the rich page, in the portal's preview.
      if (field === "sqft" && !way.whole && !(page.size === "beside" || (!way.run && (page.size === "line" || body === "rich")))) continue;
      // The year stands on a line of the facts, and one run of words has no lines.
      if (field === "yearBuilt" && way.run) continue;
    }
    out.push({ field, kind: value === undefined ? "missing" : "wrong", value });
  }
  return out;
}
