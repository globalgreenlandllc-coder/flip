/**
 * "Full analysis" in the deal finder opens a home's analysis in a new tab, and the analysis starts by itself.
 *
 * What says it should start is not in the link: a link can be reloaded, gone back to, opened twice or sent by
 * anyone, and a run costs one of the person's analyses. It is a note this browser keeps for two minutes: the finder
 * writes it when the link is clicked, and the analysis page takes it, once (components/analyzer.tsx). A page that
 * finds no note fills the form and waits for the button.
 */

/** The browser's own storage, as far as these notes use it. Any of it may throw; every use here is guarded. */
export type NoteStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const NOTE_KEY = "flip:full-analysis";
/** How long a click's note waits for its tab: time to open it, and to sign in again if asked to. */
export const NOTE_MS = 2 * 60_000;

/** One home, however its address is spaced or capitalised, cut where the analysis page cuts a handed-over address. */
const homeKey = (address: string) => address.replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();

/** The notes still waiting, by home. Anything unreadable, or not from the last two minutes, is no note. */
function waiting(store: NoteStore, now: number): Map<string, number> {
  const notes = new Map<string, number>();
  try {
    const kept: unknown = JSON.parse(store.getItem(NOTE_KEY) ?? "{}");
    if (kept && typeof kept === "object" && !Array.isArray(kept)) {
      for (const [home, at] of Object.entries(kept)) if (typeof at === "number" && now >= at && now - at < NOTE_MS) notes.set(home, at);
    }
  } catch {
    /* unreadable: no notes */
  }
  return notes;
}

function keep(store: NoteStore, notes: Map<string, number>): void {
  if (notes.size) store.setItem(NOTE_KEY, JSON.stringify(Object.fromEntries(notes)));
  else store.removeItem(NOTE_KEY);
}

/** The finder: this home's "Full analysis" was clicked. */
export function noteFullAnalysis(store: NoteStore | null, address: string, now: number): void {
  if (!store || !address.trim()) return;
  try {
    const notes = waiting(store, now);
    notes.set(homeKey(address), now);
    keep(store, notes);
  } catch {
    /* storage refused: the page will wait for the button */
  }
}

/**
 * The analysis page: was this home's "Full analysis" clicked in this browser in the last two minutes? Yes once: the
 * note is taken. When it cannot be taken away, the answer is no, so that it can never say yes twice.
 */
export function takeFullAnalysis(store: NoteStore | null, address: string | undefined, now: number): boolean {
  if (!store || !address?.trim()) return false;
  try {
    const notes = waiting(store, now);
    const home = homeKey(address);
    if (!notes.has(home)) return false;
    notes.delete(home);
    keep(store, notes);
    return true;
  } catch {
    return false;
  }
}

/** This browser's storage, or null where there is none to be had. */
export function browserNotes(): NoteStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
