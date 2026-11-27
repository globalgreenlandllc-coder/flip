import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTE_MS, NOTE_PREFIX, noteFullAnalysis, takeFullAnalysis, takeFullAnalysisOnce, type NoteLocks, type NoteStore } from "./hand-off.ts";

/** A browser's storage, in memory, with whatever else a page keeps there. */
function memory(): NoteStore & { map: Map<string, string> } {
  const map = new Map<string, string>([["theme", "dark"]]);
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}
const notes = (s: { map: Map<string, string> }) => [...s.map.keys()].filter((k) => k.startsWith(NOTE_PREFIX));

const HOME = "608 Sample St, Fixture Falls, WA 98000";
const NEXT_DOOR = "610 Sample St, Fixture Falls, WA 98000";
const T = 1_790_000_000_000;

test("Full analysis: the click's note starts that home's analysis once, in the first tab to take it", () => {
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  assert.equal(takeFullAnalysis(s, HOME, T + 1_500), true);
  // Taken: a reload, Back, or the second tab of a double click finds none, and the page waits for the button.
  assert.equal(takeFullAnalysis(s, HOME, T + 1_600), false);
  assert.deepEqual([notes(s), s.map.get("theme")], [[], "dark"], "nothing is left behind, and nothing else is touched");
  // Clicked again later: one more run, as asked.
  noteFullAnalysis(s, HOME, T + 60_000);
  assert.equal(takeFullAnalysis(s, HOME, T + 61_000), true);
});

test("Full analysis: no click in this browser, no start", () => {
  const s = memory();
  // A link opened from anywhere else (an e-mail, another site, a bookmark): no note.
  assert.equal(takeFullAnalysis(s, HOME, T), false);
  // Another home's note is not this home's, and is left for its own tab.
  noteFullAnalysis(s, NEXT_DOOR, T);
  assert.equal(takeFullAnalysis(s, HOME, T + 1_000), false);
  assert.equal(takeFullAnalysis(s, NEXT_DOOR, T + 1_000), true);
  // Two minutes on, a note is no note; and it is not kept.
  noteFullAnalysis(s, HOME, T);
  assert.deepEqual([takeFullAnalysis(s, HOME, T + NOTE_MS), notes(s)], [false, []]);
  // A note from the future (a clock put back) is no note.
  noteFullAnalysis(s, HOME, T + 5_000);
  assert.equal(takeFullAnalysis(s, HOME, T), false);
  // Old notes are cleared when a new one is written.
  noteFullAnalysis(s, NEXT_DOOR, T);
  noteFullAnalysis(s, HOME, T + NOTE_MS + 1);
  assert.deepEqual(notes(s), [`${NOTE_PREFIX}${HOME.toLowerCase()}`]);
});

test("Full analysis: homes clicked together each start once, and taking one never brings back another", () => {
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  noteFullAnalysis(s, NEXT_DOOR, T + 300);
  // Two tabs take their notes in turn; a third look at the first home finds it gone.
  assert.deepEqual([takeFullAnalysis(s, NEXT_DOOR, T + 900), takeFullAnalysis(s, HOME, T + 1_200), takeFullAnalysis(s, NEXT_DOOR, T + 1_300), takeFullAnalysis(s, HOME, T + 1_300)], [true, true, false, false]);
});

test("Full analysis: the same home, however its address is spaced or capitalised, or cut where the page cuts it", () => {
  const s = memory();
  noteFullAnalysis(s, "  608  Sample St,\nFixture Falls, WA 98000 ", T);
  assert.equal(takeFullAnalysis(s, "608 sample st, fixture falls, wa 98000", T + 1_000), true);
  const long = `608 Sample St, ${"Fixture ".repeat(30)}Falls, WA 98000`;
  noteFullAnalysis(s, long, T);
  assert.equal(takeFullAnalysis(s, long.slice(0, 160), T + 1_000), true);
});

test("Full analysis: storage that is missing, refuses, or holds anything else never starts a run, and never throws", () => {
  assert.equal(takeFullAnalysis(null, HOME, T), false);
  noteFullAnalysis(null, HOME, T);
  const blocked = () => {
    throw new Error("blocked");
  };
  const refusing: NoteStore = { getItem: blocked, setItem: blocked, removeItem: blocked, key: blocked, length: 0 };
  noteFullAnalysis(refusing, HOME, T);
  assert.equal(takeFullAnalysis(refusing, HOME, T), false);
  // It can be read but not changed: the note cannot be taken away, so it is not acted on.
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  assert.equal(takeFullAnalysis({ ...s, getItem: s.getItem, setItem: blocked, removeItem: blocked, key: s.key, length: s.length }, HOME, T + 1_000), false);
  // Or the store ignores the removal: no.
  assert.equal(takeFullAnalysis({ ...s, getItem: s.getItem, setItem: s.setItem, removeItem: () => {}, key: s.key, length: s.length }, HOME, T + 1_000), false);
  for (const kept of ["not a time", "", "-5", "1e12", String(T) + ".5", "99999999999999999999"]) {
    const odd = memory();
    odd.map.set(`${NOTE_PREFIX}${HOME.toLowerCase()}`, kept);
    assert.equal(takeFullAnalysis(odd, HOME, T + 1_000), false, kept);
  }
  // A blank address is no home.
  const blank = memory();
  noteFullAnalysis(blank, "  ", T);
  assert.deepEqual([notes(blank), takeFullAnalysis(blank, "", T), takeFullAnalysis(blank, undefined, T)], [[], false, false]);
});

test("Full analysis: tabs take notes one at a time where the browser can see to it, and without it as before", async () => {
  // A lock manager that runs one callback at a time, the way navigator.locks does for one name.
  const order: string[] = [];
  let queue = Promise.resolve();
  const locks: NoteLocks = {
    request: ((name: string, callback: () => unknown) => {
      const run = queue.then(() => {
        order.push(name);
        return callback();
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    }) as NoteLocks["request"],
  };
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  // The two tabs of a double click ask at once: one of them gets the note.
  const both = await Promise.all([takeFullAnalysisOnce(s, HOME, T + 1_000, locks), takeFullAnalysisOnce(s, HOME, T + 1_000, locks)]);
  assert.deepEqual([both.filter(Boolean).length, order], [1, [NOTE_PREFIX, NOTE_PREFIX]]);
  // No lock manager: the note is taken without one.
  noteFullAnalysis(s, HOME, T);
  assert.equal(await takeFullAnalysisOnce(s, HOME, T + 1_000, null), true);
  // A lock manager that fails: no.
  noteFullAnalysis(s, HOME, T);
  const failing: NoteLocks = { request: (async () => { throw new Error("no locks here"); }) as NoteLocks["request"] };
  assert.equal(await takeFullAnalysisOnce(s, HOME, T + 1_000, failing), false);
});
