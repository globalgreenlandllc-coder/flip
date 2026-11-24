import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import type dns from "node:dns";
import { UnsafeUrlError, checkUrl, createSafeFetch, guardedLookup, isPublicAddress, safeFetch } from "./safe-fetch.ts";

test("only addresses the open internet routes to count as public", () => {
  for (const a of ["8.8.8.8", "151.101.1.140", "2606:4700:4700::1111", "2a00:1450:4001::1"]) assert.equal(isPublicAddress(a), true, a);
  for (const a of [
    "127.0.0.1", "127.9.9.9", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "198.18.0.1", "192.0.2.10", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe",
    // Ranges nobody listed one by one are refused too: only global unicast IPv6 is public.
    "fec0::1", "::ffff:0:7f00:1", "5f00::1", "3fff::1", "100::1", "64:ff9b:1::1", "4000::1", "e000::1",
    // An IPv4 address dressed as IPv6 is refused even when the IPv4 address is public.
    "::ffff:8.8.8.8", "::8.8.8.8",
    "example.com", "", "not an address",
  ]) assert.equal(isPublicAddress(a), false, a);
});

test("an address is refused before any connection when it is not a plain public web address", () => {
  assert.equal(checkUrl("https://www.zillow.com/homedetails/1-Main-St/1_zpid/").hostname, "www.zillow.com");
  assert.equal(checkUrl("http://example.com:80/a").port, "");
  for (const bad of [
    "file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/html,hi", "gopher://example.com/", "not a url", "",
    "http://user:pw@example.com/", "https://example.com:8443/", "http://example.com:22/",
    "http://127.0.0.1/", "http://localhost/", "http://LOCALHOST./", "http://app.localhost/", "http://printer.local/", "http://db.internal/", "http://intranet/",
    "http://2130706433/", "http://0x7f.1/", "http://017700000001/", "http://127.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/", "http://10.1.2.3/", "http://192.168.0.1/", "http://[fd00::1]/", "http://0.0.0.0/",
    "http://[fec0::1]/", "http://[::ffff:0:7f00:1]/", "http://[::ffff:8.8.8.8]/",
  ]) assert.throws(() => checkUrl(bad), UnsafeUrlError, bad);
});

type LookupCallback = (err: NodeJS.ErrnoException | null, found: dns.LookupAddress[]) => void;
const fakeDns = (table: Record<string, string[]>) =>
  ((hostname: string, _options: unknown, callback: LookupCallback) => {
    const list = (table[hostname] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    process.nextTick(() => callback(null, list));
  }) as unknown as typeof dns.lookup;

test("a name is only connected to when every address it resolves to is public", async () => {
  const lookup = guardedLookup(isPublicAddress, fakeDns({ "good.example": ["93.184.216.34"], "mixed.example": ["93.184.216.34", "10.0.0.7"], "inside.example": ["127.0.0.1"], "empty.example": [] }));
  const ask = (name: string, all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => lookup(name, { all }, (err, address, family) => resolve({ err, address, family })));

  const one = await ask("good.example", false);
  assert.equal(one.err, null);
  assert.equal(one.address, "93.184.216.34");
  assert.equal(one.family, 4);
  const many = await ask("good.example", true);
  assert.deepEqual(many.address, [{ address: "93.184.216.34", family: 4 }]);

  for (const name of ["mixed.example", "inside.example", "empty.example"]) {
    const r = await ask(name, true);
    assert.ok(r.err instanceof UnsafeUrlError, name);
    assert.equal(r.err.code, "EUNSAFE");
  }
});

/** A local server for the fetcher to talk to. `hits` counts every request that reached it. */
async function withServer(handler: http.RequestListener, run: (base: string, hits: () => number, server: http.Server) => Promise<void>) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, () => hits, server);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A fetcher allowed to reach this machine, and nothing else, so the transport can be exercised. */
const localFetch = createSafeFetch({ isAllowedAddress: (a) => a === "127.0.0.1", anyPort: true });

test("the app's own fetcher never reaches this machine", async () => {
  await withServer((_req, res) => res.end("secret"), async (base, hits) => {
    await assert.rejects(safeFetch(`${base}/`), UnsafeUrlError);
    await assert.rejects(safeFetch("http://127.0.0.1/"), UnsafeUrlError);
    await assert.rejects(safeFetch("http://localhost/"), UnsafeUrlError);
    assert.equal(hits(), 0);
  });
});

test("a public-looking name that resolves inside is refused at connect time (DNS rebinding)", async () => {
  await withServer((_req, res) => res.end("secret"), async (base, hits) => {
    const port = new URL(base).port;
    // Public-only policy, any port, and a DNS that points the name at this machine.
    const fetcher = createSafeFetch({ anyPort: true }, fakeDns({ "rebind.example": ["127.0.0.1"] }));
    await assert.rejects(fetcher(`http://rebind.example:${port}/`), (err: NodeJS.ErrnoException) => err.code === "EUNSAFE");
    assert.equal(hits(), 0);
  });
});

test("reads a page, its type and its status", async () => {
  await withServer((req, res) => {
    if (req.url === "/missing") {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("nope");
    }
    res.writeHead(200, { "content-type": "Text/HTML; charset=utf-8" });
    res.end(`<title>hi</title> ua=${req.headers["user-agent"]}`);
  }, async (base) => {
    const ok = await localFetch(`${base}/page`, { headers: { "user-agent": "test-agent" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.ok, true);
    assert.equal(ok.contentType, "text/html");
    assert.equal(ok.body.toString("utf8"), "<title>hi</title> ua=test-agent");
    assert.equal(ok.url, `${base}/page`);
    const missing = await localFetch(`${base}/missing`);
    assert.equal(missing.status, 404);
    assert.equal(missing.ok, false);
  });
});

test("decompresses gzip and deflate; asks for nothing else and refuses anything else", async () => {
  const text = "listing ".repeat(500);
  const asked: string[] = [];
  await withServer((req, res) => {
    asked.push(String(req.headers["accept-encoding"]));
    const kind = (req.url ?? "/").slice(1);
    const body = kind === "gzip" ? zlib.gzipSync(text) : kind === "deflate" ? zlib.deflateSync(text) : kind === "br" ? zlib.brotliCompressSync(text) : Buffer.from(text);
    res.writeHead(200, { "content-encoding": kind, "content-type": "text/html" });
    res.end(body);
  }, async (base) => {
    for (const kind of ["gzip", "deflate", "identity"]) assert.equal((await localFetch(`${base}/${kind}`)).body.toString("utf8"), text, kind);
    // Brotli's worst case is a million to one; a server that sends it unasked is not read.
    for (const kind of ["br", "zstd", "gzip, gzip"]) await assert.rejects(localFetch(`${base}/${kind}`), /compression this server does not read/, kind);
    assert.deepEqual([...new Set(asked)], ["gzip, deflate"]);
  });
});

test("stops at the size cap, counted after decompression", async () => {
  await withServer((req, res) => {
    if (req.url === "/bomb") {
      res.writeHead(200, { "content-encoding": "gzip" });
      return res.end(zlib.gzipSync(Buffer.alloc(2_000_000, "a")));
    }
    res.end(Buffer.alloc(300_000, "a"));
  }, async (base) => {
    await assert.rejects(localFetch(`${base}/big`, { maxBytes: 100_000 }), /larger than this server reads/);
    await assert.rejects(localFetch(`${base}/bomb`, { maxBytes: 100_000 }), /larger than this server reads/);
    assert.equal((await localFetch(`${base}/big`, { maxBytes: 400_000 })).body.length, 300_000);
  });
});

test("follows a few redirects and no more", async () => {
  await withServer((req, res) => {
    const n = Number((req.url ?? "/0").slice(1));
    if (n > 0) {
      res.writeHead(302, { location: `/${n - 1}` });
      return res.end();
    }
    res.end("arrived");
  }, async (base) => {
    const res = await localFetch(`${base}/5`);
    assert.equal(res.body.toString(), "arrived");
    assert.equal(res.url, `${base}/0`);
    await assert.rejects(localFetch(`${base}/6`), /redirects too many times/);
    await assert.rejects(localFetch(`${base}/1`, { maxRedirects: 0 }), /redirects too many times/);
  });
});

test("a redirect cannot lead somewhere the first address could not go", async () => {
  await withServer((req, res) => {
    const to: Record<string, string> = {
      "/to-metadata": "http://169.254.169.254/latest/meta-data/",
      "/to-private": "http://10.0.0.1/admin",
      "/to-file": "file:///etc/passwd",
      "/to-localhost-name": "http://localhost/",
      "/to-other-loopback": "http://127.0.0.2/",
    };
    const location = to[req.url ?? ""];
    if (location) {
      res.writeHead(302, { location });
      return res.end();
    }
    res.end("should not get here");
  }, async (base, hits) => {
    for (const path of ["/to-metadata", "/to-private", "/to-file", "/to-localhost-name", "/to-other-loopback"]) {
      await assert.rejects(localFetch(`${base}${path}`), UnsafeUrlError, path);
    }
    // One hit each for the five redirecting pages; nothing was fetched after them.
    assert.equal(hits(), 5);
  });
});

test("lets go of the connection however the exchange ends", async () => {
  // Each of these servers would keep the connection for as long as it liked.
  const endless = (res: http.ServerResponse) => {
    const timer = setInterval(() => res.write("x".repeat(1024)), 20);
    res.on("close", () => clearInterval(timer));
  };
  const cases: Record<string, http.RequestListener> = {
    "/redirect-that-keeps-talking": (_req, res) => {
      res.writeHead(302, { location: "/done" });
      endless(res);
    },
    "/done": (_req, res) => res.end("ok"),
    "/not-really-gzip": (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      endless(res);
    },
    "/too-big": (_req, res) => {
      res.writeHead(200);
      endless(res);
    },
    "/unknown-compression": (_req, res) => {
      res.writeHead(200, { "content-encoding": "br" });
      endless(res);
    },
    "/never-answers": () => {},
  };
  let open = 0;
  await withServer((req, res) => {
    cases[req.url ?? ""]?.(req, res);
  }, async (base, _hits, server) => {
    const idle = async (what: string) => {
      // The client closed its end; give the server's side a moment to notice.
      for (let i = 0; i < 40; i++) {
        open = await new Promise<number>((resolve) => server.getConnections((_err, n) => resolve(n)));
        if (open === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(`${what}: ${open} connection(s) still open a second later`);
    };
    assert.equal((await localFetch(`${base}/redirect-that-keeps-talking`)).body.toString(), "ok");
    await idle("a redirect whose own body never ends");
    await assert.rejects(localFetch(`${base}/not-really-gzip`));
    await idle("a body that is not the compression it claims");
    await assert.rejects(localFetch(`${base}/too-big`, { maxBytes: 50_000 }), /larger than this server reads/);
    await idle("a body past the cap");
    await assert.rejects(localFetch(`${base}/unknown-compression`), /compression this server does not read/);
    await idle("a compression that is not read");
    await assert.rejects(localFetch(`${base}/never-answers`, { timeoutMs: 100 }), /took too long/);
    await idle("a server that never answers");
  });
});

test("a body that inflates enormously is cut at the cap, and the decompressor with it", async () => {
  // 300 MB of zeros is about 300 KB of gzip.
  const bomb = zlib.gzipSync(Buffer.alloc(300 * 1024 * 1024), { level: 9 });
  await withServer((_req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(bomb);
  }, async (base) => {
    const cpuBefore = process.cpuUsage();
    const started = Date.now();
    await assert.rejects(localFetch(`${base}/bomb`, { maxBytes: 100_000 }), /larger than this server reads/);
    assert.ok(Date.now() - started < 1_000, "rejected promptly");
    // Left running, inflating the rest takes on the order of a second of CPU. Destroyed, it takes none.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const cpu = process.cpuUsage(cpuBefore);
    assert.ok((cpu.user + cpu.system) / 1000 < 250, `decompressor kept working: ${Math.round((cpu.user + cpu.system) / 1000)} ms of CPU`);
  });
});

test("gives up at the deadline", async () => {
  await withServer(() => {
    /* never answers */
  }, async (base) => {
    const started = Date.now();
    await assert.rejects(localFetch(`${base}/slow`, { timeoutMs: 150 }), /took too long/);
    assert.ok(Date.now() - started < 2_000);
  });
});
