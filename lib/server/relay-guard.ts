import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

/**
 * Keeps the model relay from being turned against the network it runs on:
 * only public addresses, checked at connect time (so a DNS answer can't change
 * between the check and the connection), no redirects, no path tricks.
 */

export type RelayPolicy = { allowHttp: boolean; allowPrivate: boolean };

export function relayPolicy(): RelayPolicy {
  const dev = process.env.NODE_ENV === "development";
  return {
    allowHttp: dev || process.env.TALKTHROUGH_RELAY_ALLOW_HTTP === "1",
    allowPrivate: dev || process.env.TALKTHROUGH_RELAY_ALLOW_PRIVATE === "1",
  };
}

// ─── Address checks ─────────────────────────────────────────────────────────

function ipv4Bytes(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").map(Number);
}

/** Expands any IPv6 text form (compressed, with an embedded IPv4 tail) to 16 bytes. */
export function ipv6Bytes(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let text = ip.replace(/%.*$/, "");
  let tail: number[] = [];
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    tail = ipv4Bytes(v4[1]) ?? [];
    text = text.slice(0, -v4[1].length) + "0:0";
  }
  const [head, rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = rest !== undefined ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  const bytes = groups.flatMap((g) => {
    const n = parseInt(g || "0", 16);
    return [(n >> 8) & 0xff, n & 0xff];
  });
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

function privateV4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** True for loopback, private, link-local, CGNAT, multicast and IPv4 embedded in any of those. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Bytes(ip);
  if (v4) return privateV4(v4);
  const b = ipv6Bytes(ip);
  if (!b) return true; // Unparseable: refuse.
  const zeroUpTo = (n: number) => b.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (zeroUpTo(15) && (b[15] === 0 || b[15] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (zeroUpTo(10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) return privateV4(b.slice(12));
  // NAT64 64:ff9b::/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return privateV4(b.slice(12));
  }
  // 6to4 2002::/16 carries an IPv4 address in the next four bytes.
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(b.slice(2, 6));
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xff) return true; // multicast
  return false;
}

const LOCAL_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|metadata\.google\.internal)$/i;

/**
 * Validates a user-supplied base URL before the relay connects to it.
 * Returns the URL, or a plain-English reason for refusing.
 */
export function checkRelayTarget(raw: unknown, selfHost: string | null, policy = relayPolicy()): URL | string {
  if (typeof raw !== "string" || raw.length > 500) return "Missing or invalid base URL.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That base URL isn't a valid address.";
  }
  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    return "The relay only connects to https addresses. Local model servers can't be reached from the hosted app.";
  }
  if (url.username || url.password) return "Base URLs with embedded credentials aren't supported.";
  if (url.search || url.hash || raw.includes("#") || raw.includes("?")) {
    return "The base URL shouldn't include a query or a fragment.";
  }
  if (selfHost && url.host.toLowerCase() === selfHost.toLowerCase()) return "The relay can't call itself.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!policy.allowPrivate) {
    if (LOCAL_NAMES.test(host)) return "The relay can't reach local or internal addresses.";
    if (isIP(host) && isPrivateAddress(host)) return "The relay can't reach private network addresses.";
  }
  return url;
}

/** The provider's chat completions endpoint, built without string tricks. */
export function chatEndpoint(base: URL): URL {
  const url = new URL(base.toString());
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  return url;
}

// ─── Pinned connections ─────────────────────────────────────────────────────

export class RelayConnectError extends Error {
  constructor(public reason: "private" | "unresolved" | "unreachable", message: string) {
    super(message);
    this.name = "RelayConnectError";
  }
}

/** DNS lookup used for the actual connection: every answer must be public. */
function guardedLookup(policy: RelayPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      const list = (addresses ?? []) as LookupAddress[];
      if (err || list.length === 0) {
        callback(err ?? new RelayConnectError("unresolved", `Couldn't find the server ${hostname}.`), "", 4);
        return;
      }
      if (!policy.allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        callback(new RelayConnectError("private", "The relay can't reach private network addresses."), "", 4);
        return;
      }
      if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

export type RelayResponse = { status: number; headers: Headers; body: ReadableStream<Uint8Array> };

/** POSTs JSON to the endpoint over a connection pinned to vetted addresses. Never follows redirects. */
export function relayPost(
  endpoint: URL,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
  policy = relayPolicy(),
): Promise<RelayResponse> {
  return new Promise((resolve, reject) => {
    const mod = endpoint.protocol === "https:" ? https : http;
    const req = mod.request(
      endpoint,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        lookup: guardedLookup(policy),
        signal,
        timeout: 295_000,
      },
      (res) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") out.set(k, v);
          else if (Array.isArray(v)) out.set(k, v.join(", "));
        }
        resolve({
          status: res.statusCode ?? 502,
          headers: out,
          body: Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>,
        });
      },
    );
    req.on("timeout", () => req.destroy(new RelayConnectError("unreachable", "The provider took too long to answer.")));
    req.on("error", (err) =>
      reject(err instanceof RelayConnectError ? err : new RelayConnectError("unreachable", `Couldn't connect to ${endpoint.host}.`)),
    );
    req.end(body);
  });
}

/** Reads a request body up to a byte limit, without trusting Content-Length. */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
