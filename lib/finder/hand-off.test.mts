import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTE_KEY, NOTE_MS, noteFullAnalysis, takeFullAnalysis, type NoteStore } from "./hand-off.ts";

/** A browser's storage, in memory. */
function memory(): NoteStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) };
}

const HOME = "608 Sample St, Fixture Falls, WA 98000";
const NEXT_DOOR = "610 Sample St, Fixture Falls, WA 98000";
const T = 1_790_000_000_000;

test("Full analysis: the click's note starts that home's analysis once, in the first tab to take it", () => {
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  assert.equal(takeFullAnalysis(s, HOME, T + 1_500), true);
  // Taken: a reload, Back, or the second tab of a double click finds none, and the page waits for the button.
  assert.equal(takeFullAnalysis(s, HOME, T + 1_600), false);
  assert.equal(s.map.has(NOTE_KEY), false, "nothing is left behind");
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
  // Two minutes on, a note is gone.
  noteFullAnalysis(s, HOME, T);
  assert.equal(takeFullAnalysis(s, HOME, T + NOTE_MS), false);
  // A note from the future (a clock put back) is no note.
  noteFullAnalysis(s, HOME, T + 5_000);
  assert.equal(takeFullAnalysis(s, HOME, T), false);
});

test("Full analysis: two homes clicked one after the other each start once", () => {
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  noteFullAnalysis(s, NEXT_DOOR, T + 300);
  assert.deepEqual([takeFullAnalysis(s, NEXT_DOOR, T + 900), takeFullAnalysis(s, HOME, T + 1_200), takeFullAnalysis(s, HOME, T + 1_300)], [true, true, false]);
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
  const refusing: NoteStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  noteFullAnalysis(refusing, HOME, T);
  assert.equal(takeFullAnalysis(refusing, HOME, T), false);
  // It can be read but not changed: the note cannot be taken away, so it is not acted on.
  const s = memory();
  noteFullAnalysis(s, HOME, T);
  const readOnly: NoteStore = { getItem: s.getItem, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("full"); } };
  assert.equal(takeFullAnalysis(readOnly, HOME, T + 1_000), false);
  for (const kept of ["not json", "[1,2]", "null", JSON.stringify({ [HOME.toLowerCase()]: String(T) }), `{"__proto__": ${T}}`]) {
    const odd = memory();
    odd.map.set(NOTE_KEY, kept);
    assert.equal(takeFullAnalysis(odd, HOME, T + 1_000), false, kept);
  }
  // A blank address is no home.
  const blank = memory();
  noteFullAnalysis(blank, "  ", T);
  assert.deepEqual([blank.map.size, takeFullAnalysis(blank, "", T), takeFullAnalysis(blank, undefined, T)], [0, false, false]);
});
