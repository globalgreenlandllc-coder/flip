/**
 * What is done to a page's HTML before anything is read from it: finding tags
 * and their attributes, the JSON-LD blocks, the visible text.
 *
 * The page is whatever a pasted link serves, so all of it is plain scanning,
 * one pass over the page. A pattern that can be made to look again at what it
 * has already looked at will be: a megabyte built for it took minutes.
 * Nothing here matches a tag with a pattern that can run past the tag's end.
 *
 * Pure and bundled for the browser too (a pasted page is read there).
 */

/** Pages are cut to this before anything looks at them. */
export const MAX_HTML_CHARS = 4_000_000;

/**
 * Lower-cased for searching, position for position. "İ" lower-cases to two
 * characters, which would move every index after it away from the page's own.
 */
export function lowerForSearch(s: string): string {
  const lower = (s.includes("İ") ? s.split("İ").join("i") : s).toLowerCase();
  return lower.length === s.length ? lower : s.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

// ── tags ────────────────────────────────────────────────────────────────────

export interface Tag {
  name: string;
  /** Attribute names lower-cased; the first of a repeated attribute wins, as in a browser. */
  attrs: Map<string, string>;
  /** Where the tag ends in the page (the index after its ">"). */
  end: number;
}

const MAX_TAG_CHARS = 8_000;
const MAX_ATTRS = 60;

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
const isNameChar = (code: number) => (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57);

/** The attributes of one tag, read in one walk over it. `inside` is the tag without its name and its ">". */
function tagAttrs(inside: string): Map<string, string> {
  const out = new Map<string, string>();
  const n = inside.length;
  let i = 0;
  while (i < n && out.size < MAX_ATTRS) {
    while (i < n && (isSpace(inside.charCodeAt(i)) || inside[i] === "/")) i++;
    if (i >= n) break;
    const nameStart = i;
    while (i < n && !isSpace(inside.charCodeAt(i)) && inside[i] !== "=" && inside[i] !== "/") i++;
    const name = inside.slice(nameStart, i).toLowerCase();
    while (i < n && isSpace(inside.charCodeAt(i))) i++;
    let value = "";
    if (inside[i] === "=") {
      i++;
      while (i < n && isSpace(inside.charCodeAt(i))) i++;
      const quote = inside[i];
      if (quote === '"' || quote === "'") {
        const close = inside.indexOf(quote, i + 1);
        value = close < 0 ? inside.slice(i + 1) : inside.slice(i + 1, close);
        i = close < 0 ? n : close + 1;
      } else {
        const valueStart = i;
        while (i < n && !isSpace(inside.charCodeAt(i))) i++;
        value = inside.slice(valueStart, i);
      }
    }
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}

/**
 * The page's tags of the given names, in page order, each with its
 * attributes. A tag runs from "<name" to the first ">" after it. One that
 * meets another "<" first, or is longer than any tag, is not a tag and is
 * passed over.
 *
 * One pass. Where the next ">" is, is found once and remembered until the
 * scan has gone past it, so a page of tags that never close is not searched
 * to its end once for each of them.
 */
export function scanTags(html: string, names: string[], max = 4_000): Tag[] {
  const out: Tag[] = [];
  const wanted = new Set(names);
  const longest = Math.max(...names.map((n) => n.length));
  let at = 0;
  /** -2: not looked for yet. -1: there is none left. */
  let close = -2;
  while (out.length < max) {
    const open = html.indexOf("<", at);
    if (open < 0) break;
    at = open + 1;
    let end = open + 1;
    while (end - open <= longest + 1 && isNameChar(html.charCodeAt(end))) end++;
    const name = html.slice(open + 1, end).toLowerCase();
    if (!wanted.has(name)) continue;
    const after = html.charCodeAt(end);
    if (!(isSpace(after) || after === 47 /* / */ || after === 62 /* > */)) continue;
    if (close !== -1 && close < end) close = html.indexOf(">", end);
    if (close === -1) break;
    const next = html.indexOf("<", end);
    if (next !== -1 && next < close) {
      at = next;
      continue;
    }
    if (close - open <= MAX_TAG_CHARS) out.push({ name, attrs: tagAttrs(html.slice(end, close)), end: close + 1 });
    at = close + 1;
  }
  return out;
}

const MAX_JSON_LD_BLOCKS = 50;

/**
 * The bodies of the page's JSON-LD scripts, found by plain scanning: once no
 * closing tag is left, it stops, instead of searching the rest of the page
 * for every script that was never closed.
 */
export function jsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const lower = lowerForSearch(html);
  let at = 0;
  while (out.length < MAX_JSON_LD_BLOCKS) {
    const open = lower.indexOf("<script", at);
    if (open < 0) break;
    const tagEnd = lower.indexOf(">", open);
    if (tagEnd < 0) break;
    const close = lower.indexOf("</script", tagEnd);
    if (close < 0) break;
    if (lower.slice(open, tagEnd).includes("application/ld+json")) out.push(html.slice(tagEnd + 1, close));
    at = close + "</script".length;
  }
  return out;
}

const MAX_JSON_LD_BLOCK_CHARS = 500_000;

/**
 * The page's JSON-LD, parsed once for everyone who reads it (the photos, the
 * price, the description). A block that is not JSON is left out, and so is
 * one larger than any listing's: half a megabyte of nested brackets parses
 * into half a gigabyte of objects.
 */
export function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const body of jsonLdBlocks(html)) {
    if (body.length > MAX_JSON_LD_BLOCK_CHARS) continue;
    try {
      out.push(JSON.parse(body));
    } catch {
      /* not JSON */
    }
  }
  return out;
}

// ── text ────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", bull: "•", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", reg: "®", trade: "™", copy: "©", deg: "°",
  frac14: "¼", frac12: "½", frac34: "¾", sup2: "²", times: "×",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, code: string) => {
    if (code[0] !== "#") return Object.hasOwn(ENTITIES, code.toLowerCase()) ? ENTITIES[code.toLowerCase()] : whole;
    const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
  });
}

/** What a reader of the page never sees: scripts, styles, drawings, form controls, and what the page's author commented out. */
const HIDDEN: { open: string; close: string }[] = [
  ...["script", "style", "noscript", "svg", "template", "select", "textarea", "iframe"].map((tag) => ({ open: `<${tag}`, close: `</${tag}` })),
  { open: "<!--", close: "-->" },
];

/**
 * The page without its hidden blocks. Scanned, not matched with a lazy
 * pattern, and each kind of block is looked for once per stretch of page:
 * where the next one starts is remembered until the scan has passed it, and
 * a kind that is not there is never looked for again. Otherwise a page of ten
 * thousand small blocks would search the rest of itself ten thousand times
 * for the kinds it does not have.
 */
function withoutHiddenBlocks(html: string): string {
  const lower = lowerForSearch(html);
  const out: string[] = [];
  const next: number[] = HIDDEN.map(() => -2);
  let at = 0;
  while (at < html.length) {
    let open = -1;
    let kind = -1;
    for (let k = 0; k < HIDDEN.length; k++) {
      if (next[k] === -2 || (next[k] >= 0 && next[k] < at)) next[k] = lower.indexOf(HIDDEN[k].open, at);
      if (next[k] >= 0 && (open < 0 || next[k] < open)) {
        open = next[k];
        kind = k;
      }
    }
    if (open < 0) {
      out.push(html.slice(at));
      break;
    }
    out.push(html.slice(at, open));
    const { open: opener, close: closer } = HIDDEN[kind];
    const close = lower.indexOf(closer, open + opener.length);
    if (close < 0) break;
    if (closer === "-->") {
      at = close + closer.length;
      continue;
    }
    const end = lower.indexOf(">", close);
    if (end < 0) break;
    at = end + 1;
  }
  return out.join(" ");
}

/** Stands between the cells of one row while the page is being turned into lines. */
const CELL = "\u001f";

export const MAX_TEXT_CHARS = 200_000;
export const MAX_LINES = 6_000;

/** One row's cells as a line: a label and its value become "Label: value", a wider row keeps its cells apart. */
function rowLine(raw: string): string {
  if (!raw.includes(CELL)) return raw.replace(/\s+/g, " ").trim();
  const cells = raw.split(CELL).map((c) => c.replace(/\s+/g, " ").trim());
  // Empty cells at either end are padding. Found by walking in from both ends once: taking them
  // off the front one at a time moves the whole row each time, and a row can be a megabyte.
  let first = 0;
  let last = cells.length;
  while (first < last && !cells[first]) first++;
  while (last > first && !cells[last - 1]) last--;
  const full = cells.slice(first, last).filter(Boolean);
  if (full.length === 2 && last - first === 2) return /[:?]$/.test(full[0]) ? `${full[0]} ${full[1]}` : `${full[0]}: ${full[1]}`;
  return full.join(" | ");
}

/**
 * The page's visible text, one line per block, the way a person selecting the
 * page and copying it would get it. A label and its value in neighbouring
 * cells (<th>Sewer</th><td>Septic</td>, <dt>Sewer</dt><dd>Septic</dd>) come
 * out as "Sewer: Septic"; a row of more cells keeps them apart with " | ".
 * Tags inside a line leave a space, so "<b>4</b>bd<b>3</b>ba" does not run
 * together into "4bd3ba".
 */
export function pageText(html: string): string {
  const text = withoutHiddenBlocks(html.slice(0, MAX_HTML_CHARS))
    .split(CELL)
    .join(" ")
    .replace(/<\/(?:dt|th|td)\s{0,8}>/gi, CELL)
    .replace(/<\/dd\b[^<>]*>|<\/?(?:p|div|li|ul|ol|h[1-6]|dl|dt|tr|table|section|article|header|footer|summary|details|figcaption|blockquote|nav|main|aside|form|pre|address|caption|thead|tbody|tfoot|title|option|button|br|hr)\b[^<>]*>/gi, "\n")
    .replace(/<[^<>]*>/g, " ");
  const lines: string[] = [];
  let size = 0;
  for (const raw of decodeEntities(text).split("\n")) {
    const line = rowLine(raw);
    if (!line) continue;
    size += line.length + 1;
    if (size > MAX_TEXT_CHARS || lines.length >= MAX_LINES) break;
    lines.push(line);
  }
  return lines.join("\n");
}
