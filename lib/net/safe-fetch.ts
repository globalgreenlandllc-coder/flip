import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

/**
 * The only way this server fetches a web address a person gave it (a listing
 * link, a photo link). A pasted address must not be able to reach anything
 * that is not on the public internet: this machine, the private network
 * around it, a cloud metadata service.
 *
 * Three checks, each closing a different door:
 *   1. the address itself: http/https, default port, no user:password, not an
 *      internal name, and if it is a bare IP, a public one;
 *   2. the connection: the name is resolved at connect time and EVERY address
 *      it resolves to must be public. The socket connects to the address that
 *      was checked, so a name that answers "public" once and "private" the
 *      next time (DNS rebinding) gains nothing;
 *   3. every redirect goes through 1 and 2 again, a few hops at most.
 * The body is capped after decompression and the whole exchange has one
 * deadline. However an exchange ends (answer, redirect, cap, deadline,
 * error), its socket and its decompressor are destroyed there and then: a
 * server that keeps talking, or a few kilobytes that inflate into gigabytes,
 * get no more of this machine once the answer is in. Server only: node:http,
 * node:dns.
 */

export class UnsafeUrlError extends Error {
  /** "EUNSAFE" when the refusal happened at connect time, from the lookup. */
  code?: string;
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

// Two lists, asked separately. One list would not do: Node's BlockList reads an IPv4 address as
// its IPv4-mapped IPv6 form too, so an IPv6 rule wide enough to cover the mapped range would
// refuse every IPv4 address there is.
const PRIVATE_V4 = new net.BlockList();
const NOT_GLOBAL_V6 = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) PRIVATE_V4.addSubnet(prefix, bits, "ipv4");
// IPv6: public means global unicast, 2000::/3, minus the special ranges inside it. Everything
// else is refused wholesale rather than range by range, so a range nobody listed (site-local,
// IPv4-translated, whatever comes next) is refused too. That includes every IPv4-in-IPv6 form:
// a real site is reached by its IPv4 or its IPv6 address, never by one dressed as the other.
for (const [prefix, bits] of [
  ["::", 3], // 0000::/3: unspecified, loopback, IPv4-mapped / -compatible / -translated, NAT64, discard
  ["4000::", 2], // 4000::/2: unallocated
  ["8000::", 1], // 8000::/1: unique local, link-local, site-local, multicast, the rest
  ["2001::", 23], // protocol assignments, Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation
] as const) NOT_GLOBAL_V6.addSubnet(prefix, bits, "ipv6");

/** True for an address the open internet routes to. Anything that is not an IP address is not public. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !PRIVATE_V4.check(address, "ipv4");
  if (family === 6) return !NOT_GLOBAL_V6.check(address, "ipv6");
  return false;
}

const INTERNAL_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home\.arpa)$/;

export interface FetchPolicy {
  /** Which resolved addresses may be connected to. */
  isAllowedAddress: (address: string) => boolean;
  /** Ports other than 80/443. Off outside tests. */
  anyPort: boolean;
}

const PUBLIC_ONLY: FetchPolicy = { isAllowedAddress: isPublicAddress, anyPort: false };

/** The address as a URL if it may be fetched; throws UnsafeUrlError saying why not. */
export function checkUrl(raw: string | URL, policy: FetchPolicy = PUBLIC_ONLY): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new UnsafeUrlError("That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http and https addresses are read.");
  if (url.username || url.password) throw new UnsafeUrlError("Addresses that carry a user name or password are not read.");
  // URL drops the default port, so anything left is a non-standard one.
  if (url.port !== "" && !policy.anyPort) throw new UnsafeUrlError("Addresses on a non-standard port are not read.");
  // URL has already turned 0x7f.1, 2130706433 and the like into dotted IPv4.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new UnsafeUrlError("That address has no host.");
  if (net.isIP(host)) {
    if (!policy.isAllowedAddress(host)) throw new UnsafeUrlError("That address is not on the public internet.");
  } else if (INTERNAL_NAME.test(host) || !host.includes(".")) {
    throw new UnsafeUrlError("That address is not on the public internet.");
  }
  return url;
}

type Resolver = typeof dns.lookup;

/** A connect-time lookup that only hands back addresses the policy allows. One bad address fails the whole name. */
export function guardedLookup(isAllowed: (address: string) => boolean, resolve: Resolver = dns.lookup): net.LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err: NodeJS.ErrnoException | null, found: dns.LookupAddress[]) => {
      if (err) return callback(err, []);
      const list = Array.isArray(found) ? found : [];
      if (!list.length || list.some((a) => !isAllowed(a.address))) {
        const refused = new UnsafeUrlError(`${hostname} does not lead to the public internet.`);
        refused.code = "EUNSAFE";
        return callback(refused, []);
      }
      if ((options as dns.LookupAllOptions).all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** One deadline for the whole exchange, redirects included. Default 10 s. */
  timeoutMs?: number;
  /** Largest body accepted, counted after decompression. Default 5 MB. */
  maxBytes?: number;
  /** Default 5. */
  maxRedirects?: number;
}

export interface SafeResponse {
  /** The address that answered, after redirects. */
  url: string;
  status: number;
  ok: boolean;
  /** Lower-cased; "" when the server sent none. */
  contentType: string;
  body: Buffer;
}

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(url: URL, headers: Record<string, string>, lookup: net.LookupFunction, msLeft: number, maxBytes: number): Promise<Raw> {
  return new Promise<Raw>((resolve, reject) => {
    let settled = false;
    let unzip: zlib.Gunzip | zlib.Inflate | null = null;
    /** Settle once, and let go of everything: the socket, the decompressor, the timer. */
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A decompressor left alone keeps inflating what it was already handed (kilobytes of
      // brotli or gzip can be gigabytes); a socket left alone stays open as long as the server likes.
      unzip?.destroy();
      req.destroy();
      fn();
    };
    const lib = url.protocol === "https:" ? https : http;
    // agent: false = a socket of its own, never one pooled by an unguarded caller.
    // No brotli: nothing needs it, and its worst case is a million to one.
    const req = lib.request(url, { method: "GET", agent: false, lookup, headers: { "accept-encoding": "gzip, deflate", ...headers } }, (res) => {
      const status = res.statusCode ?? 0;
      // A redirect's own body is of no interest; the connection ends here.
      if (status >= 300 && status < 400 && res.headers.location) return done(() => resolve({ status, headers: res.headers, body: Buffer.alloc(0) }));
      const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
      let stream: Readable = res;
      if (encoding === "gzip" || encoding === "x-gzip") stream = unzip = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = unzip = res.pipe(zlib.createInflate());
      else if (encoding !== "" && encoding !== "identity") return done(() => reject(new Error("The address answered in a compression this server does not read.")));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) return done(() => reject(new Error("The page is larger than this server reads.")));
        chunks.push(chunk);
      });
      stream.on("end", () => done(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) })));
      stream.on("error", (err) => done(() => reject(err)));
      res.on("error", (err) => done(() => reject(err)));
    });
    const timer = setTimeout(() => done(() => reject(Object.assign(new Error("The address took too long to answer."), { name: "TimeoutError" }))), Math.max(1, msLeft));
    req.on("error", (err) => done(() => reject(err)));
    req.end();
  });
}

/**
 * A fetcher under a policy. The app uses `safeFetch` below, which is public
 * internet only; the arguments exist so tests can reach their own local
 * server and stand in for DNS.
 */
export function createSafeFetch(overrides: Partial<FetchPolicy> = {}, resolve: Resolver = dns.lookup) {
  const policy: FetchPolicy = { ...PUBLIC_ONLY, ...overrides };
  const lookup = guardedLookup(policy.isAllowedAddress, resolve);
  return async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeResponse> {
    const { headers = {}, timeoutMs = 10_000, maxBytes = 5_000_000, maxRedirects = 5 } = options;
    const deadline = Date.now() + timeoutMs;
    let url = checkUrl(input, policy);
    for (let hop = 0; ; hop++) {
      const res = await requestOnce(url, headers, lookup, deadline - Date.now(), maxBytes);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= maxRedirects) throw new Error("The address redirects too many times.");
        url = checkUrl(new URL(location, url), policy);
        continue;
      }
      return {
        url: url.toString(),
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        contentType: String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase(),
        body: res.body,
      };
    }
  };
}

/** Fetch a web address a person supplied. Public internet only. */
export const safeFetch = createSafeFetch();
