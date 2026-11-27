/**
 * "Full analysis" in the deal finder opens a home's analysis in a new tab, and the analysis starts by itself.
 *
 * What says it should start is not in the link: a link can be reloaded, gone back to, opened twice or sent by
 * anyone, and a run costs one of the person's analyses. It is a note this browser keeps for two minutes: the finder
 * writes it when the link is clicked, and the analysis page takes it, once (components/analyzer.tsx). A page that
 * finds no note fills the form and waits for the button.
 *
 * Each home's note is a storage entry of its own, written and taken alone: tabs opened together never write back a
 * note another tab has taken.
 */

/** The browser's own storage, as far as these notes use it. Any of it may throw; every use here is guarded. */
export type NoteStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
/** What `navigator.locks` offers, as far as taking a note uses it. */
export type NoteLocks = Pick<LockManager, "request">;

export const NOTE_PREFIX = "flip:full-analysis:";
/** How long a click's note waits for its tab: time to open it, and to sign in again if asked to. */
export const NOTE_MS = 2 * 60_000;

/** One home, however its address is spaced or capitalised, cut where the analysis page cuts a handed-over address. */
const noteKey = (address: string) => NOTE_PREFIX + address.replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();

/** A note's time, if it is one from the last two minutes. */
function fresh(kept: string | null, now: number): boolean {
  if (kept === null || !/^\d{1,16}$/.test(kept)) return false;
  const at = Number(kept);
  return now >= at && now - at < NOTE_MS;
}

/** The finder: this home's "Full analysis" was clicked. Notes older than two minutes are cleared on the way. */
export function noteFullAnalysis(store: NoteStore | null, address: string, now: number): void {
  if (!store || !address.trim()) return;
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key?.startsWith(NOTE_PREFIX) && !fresh(store.getItem(key), now)) store.removeItem(key);
    }
    store.setItem(noteKey(address), String(now));
  } catch {
    /* storage refused: the page will wait for the button */
  }
}

/**
 * The analysis page: was this home's "Full analysis" clicked in this browser in the last two minutes? Yes once: the
 * note is taken, and nothing else is touched. When it cannot be taken away, the answer is no, so that it can never
 * say yes twice.
 */
export function takeFullAnalysis(store: NoteStore | null, address: string | undefined, now: number): boolean {
  if (!store || !address?.trim()) return false;
  try {
    const key = noteKey(address);
    const kept = store.getItem(key);
    if (kept === null) return false;
    store.removeItem(key);
    return store.getItem(key) === null && fresh(kept, now);
  } catch {
    return false;
  }
}

/**
 * takeFullAnalysis, one tab at a time where the browser can see to it (navigator.locks): the two tabs of a double
 * click cannot both take the same note, however close together they open.
 */
export async function takeFullAnalysisOnce(store: NoteStore | null, address: string | undefined, now: number, locks: NoteLocks | null = browserLocks()): Promise<boolean> {
  if (!locks) return takeFullAnalysis(store, address, now);
  try {
    return await locks.request(NOTE_PREFIX, () => takeFullAnalysis(store, address, now));
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

function browserLocks(): NoteLocks | null {
  try {
    return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}
