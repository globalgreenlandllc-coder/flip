import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { analyzePhotos, isPhotoReadError, type PhotoInput } from "./analyze-photos.ts";

/**
 * The photo reading against a stand-in for the Messages API on this machine.
 * What matters here is what each way of failing tells the person, and whether
 * it is counted as paid for: an answer that was generated is, a request that
 * brought no answer back is not.
 */
const PHOTO: PhotoInput = { base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64"), mediaType: "image/jpeg" };
const ASSESSMENT = {
  overallCondition: "dated",
  summary: "Dated but solid.",
  rooms: [{ room: "kitchen", label: "Kitchen", condition: 7, finishLevel: "dated", issues: [], keep: [], photoIndexes: [1, 9] }],
  categoryNeeds: { kitchen: "replace", baths: "refresh", flooring: "refresh", paint: "refresh", exterior: "none", landscaping: "none", windows: "none", roof: "unknown", electrical: "unknown", plumbing: "unknown", hvac: "unknown", basement: "none" },
  redFlags: [],
  unknowns: ["roof age"],
};
const message = (text: string, over: Record<string, unknown> = {}) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1_000, output_tokens: 300, cache_creation_input_tokens: 20, cache_read_input_tokens: 5 }, ...over });

type Reply = { status: number; body: unknown };

async function withApi(reply: Reply, run: (requests: () => Record<string, unknown>[]) => Promise<void>, env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: "test-key-not-real" }) {
  const requests: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw || "{}"));
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const keys = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    await run(() => requests);
  } finally {
    for (const k of keys) if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k];
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function failure(): Promise<{ message: string; billed: boolean }> {
  try {
    await analyzePhotos([PHOTO]);
  } catch (err) {
    assert.ok(isPhotoReadError(err), `expected a PhotoReadError, got ${String(err)}`);
    return { message: err.message, billed: err.billed };
  }
  return assert.fail("expected the photo reading to fail");
}

test("a good answer comes back as the assessment, tidied, with what it cost", async () => {
  await withApi({ status: 200, body: message(JSON.stringify(ASSESSMENT)) }, async (requests) => {
    const reading = await analyzePhotos([PHOTO], { address: "1 Main St", sqft: 1_840 });
    assert.equal(reading.assessment.overallCondition, "dated");
    // The model said 7 out of 5, about photos 1 and 9 of one: held to what the numbers mean.
    assert.equal(reading.assessment.rooms[0].condition, 5);
    assert.deepEqual(reading.assessment.rooms[0].photoIndexes, [1]);
    assert.deepEqual({ model: reading.model, inputTokens: reading.inputTokens, outputTokens: reading.outputTokens }, { model: "claude-test", inputTokens: 1_025, outputTokens: 300 });
    const sent = requests()[0] as { output_config?: { format?: { type?: string } }; messages?: { content: { type: string; text?: string }[] }[] };
    assert.equal(sent.output_config?.format?.type, "json_schema");
    assert.match(sent.messages![0].content.at(-1)!.text!, /Known facts: Address: 1 Main St, 1840 sqft\./);
  });
});

test("an answer that was generated and cannot be used is paid for, whatever was wrong with it", async () => {
  const cases: [Reply, RegExp][] = [
    [{ status: 200, body: message("I could not produce JSON this time.") }, /came back in a form flip could not use/],
    [{ status: 200, body: message(JSON.stringify({ ...ASSESSMENT, overallCondition: "sparkling" })) }, /came back in a form flip could not use/],
    [{ status: 200, body: message("", { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "The photos show people." } }) }, /Claude declined to assess these photos: The photos show people\./],
    [{ status: 200, body: message('{"overallCondition":"dat', { stop_reason: "max_tokens" }) }, /Assessment was cut off\. Try fewer photos\./],
    [{ status: 200, body: message("", { content: [] }) }, /returned no structured assessment/],
  ];
  for (const [reply, words] of cases) {
    await withApi(reply, async () => {
      const f = await failure();
      assert.match(f.message, words);
      assert.equal(f.billed, true, f.message);
    });
  }
});

test("a request that brought no answer back is not paid for, and the person is told what will help", async () => {
  const error = (type: string) => ({ type: "error", error: { type, message: `details the person should not see: KEY-LIKE-TEXT ${type}` } });
  const cases: [number, string, RegExp][] = [
    // Waiting helps.
    [529, "overloaded_error", /did not answer\. Try again in a minute\./],
    [500, "api_error", /did not answer\. Try again in a minute\./],
    // Different photos help.
    [400, "invalid_request_error", /could not take these photos\. Try fewer or smaller ones\./],
    [413, "request_too_large", /could not take these photos\. Try fewer or smaller ones\./],
    // Nothing the person does helps.
    [401, "authentication_error", /not set up correctly on our side\. Trying again will not help/],
    [403, "permission_error", /not set up correctly on our side/],
    [404, "not_found_error", /not set up correctly on our side/],
  ];
  for (const [status, type, words] of cases) {
    await withApi({ status, body: error(type) }, async () => {
      const f = await failure();
      assert.match(f.message, words, String(status));
      assert.equal(f.billed, false, String(status));
      assert.doesNotMatch(f.message, /KEY-LIKE-TEXT|details the person/);
    });
  }
});

test("a server with no key for the AI says so without asking the AI, and charges nobody", async () => {
  // No key, no token, and a profile name that does not exist: no way to authenticate.
  await withApi({ status: 200, body: message(JSON.stringify(ASSESSMENT)) }, async (requests) => {
    const f = await failure();
    assert.match(f.message, /not set up correctly on our side/);
    assert.equal(f.billed, false);
    assert.equal(requests().length, 0);
  }, { ANTHROPIC_API_KEY: undefined, ANTHROPIC_PROFILE: "flip-test-no-such-profile" });
});
