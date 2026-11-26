import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDemoProvider, isUntestedProvider, providerToSave } from "./demo.ts";

test("the action that saves a deal asks the rule what it may be saved as, and stores that and nothing the browser said", () => {
  // The action itself needs a signed-in person and a database, so it is read, not run: a tripwire for the day
  // somebody stores `payload.provider`, or drops the rule.
  const source = readFileSync(new URL("../../app/app/deals/actions.ts", import.meta.url), "utf8");
  assert.match(source, /const provider = providerToSave\(payload\.provider, deal\.verdict, rentcastFromEnv\(\) !== null\);\s+if \(provider === null\) return \{ ok: false,/);
  const create = source.slice(source.indexOf("db.deal.create("), source.indexOf("revalidatePath("));
  assert.match(create, /\n\s+provider,\n/);
  assert.doesNotMatch(create, /provider:/);
  // The verdict stored is the one the rule saw.
  assert.match(create, /verdict: report\.deal\.verdict,/);
  assert.match(source, /const deal = payload\?\.report\?\.deal;/);
  assert.match(source, /const \{ report \} = payload;/);
});

test("every result is marked: made-up data as DEMO, real sold prices as UNTESTED, and one that does not say is a demo", () => {
  assert.deepEqual([isDemoProvider("synthetic"), isDemoProvider(null), isDemoProvider(undefined), isDemoProvider(""), isDemoProvider("rentcast")], [true, true, true, true, false]);
  assert.deepEqual([isUntestedProvider("rentcast"), isUntestedProvider("synthetic"), isUntestedProvider(null), isUntestedProvider("caller")], [true, false, false, false]);
});

test("nothing can be saved that would be shown as a verdict with no mark on it, or as a GO on real sold prices", () => {
  const claims = ["rentcast", "synthetic", "caller", "RentCast", "tested", "", null, undefined, 7, { name: "rentcast" }];
  const verdicts = ["GO", "TIGHT", "PASS", "CHECK FIRST"];
  for (const realDataOn of [true, false]) {
    for (const claimed of claims) {
      for (const verdict of verdicts) {
        const saved = providerToSave(claimed, verdict, realDataOn);
        const what = `${JSON.stringify(claimed)} / ${verdict} / real data ${realDataOn ? "on" : "off"}`;
        if (saved === null) {
          // Refused: only a GO that says it was built on real sold prices.
          assert.deepEqual([realDataOn, claimed, verdict], [true, "rentcast", "GO"], what);
          continue;
        }
        // Whatever is saved is one of the two kinds every screen marks.
        assert.ok(isDemoProvider(saved) !== isUntestedProvider(saved), what);
        assert.ok(!(isUntestedProvider(saved) && verdict === "GO"), what);
        // Without real data connected, everything is a demo, whatever the browser says.
        if (!realDataOn) assert.equal(saved, "synthetic", what);
      }
    }
  }
  assert.equal(providerToSave("rentcast", "CHECK FIRST", true), "rentcast");
  assert.equal(providerToSave("rentcast", "PASS", true), "rentcast");
  // A source no screen marks ("caller": the numbers-only route with a caller's own sales) is saved as a demo.
  assert.equal(providerToSave("caller", "GO", true), "synthetic");
});
