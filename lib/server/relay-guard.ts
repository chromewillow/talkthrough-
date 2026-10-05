import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True for loopback, private, link-local, CGNAT and other non-public ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
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
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

/**
 * Validates a user-supplied base URL before the relay connects to it, so the
 * relay can't be pointed at local or private network addresses.
 * Returns the URL, or a plain-English reason for refusing.
 */
export async function checkRelayTarget(raw: unknown): Promise<URL | string> {
  if (typeof raw !== "string" || raw.length > 500) return "Missing or invalid base URL.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That base URL isn't a valid address.";
  }
  const allowHttp = process.env.NODE_ENV === "development" || process.env.TALKTHROUGH_RELAY_ALLOW_HTTP === "1";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    return "The relay only connects to https addresses. Local model servers can't be reached from the hosted app.";
  }
  if (url.username || url.password) return "Base URLs with embedded credentials aren't supported.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowHttp) {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
      return "The relay can't reach local or internal addresses.";
    }
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addresses.length === 0) return `Couldn't find the server ${host}. Check the base URL.`;
    if (addresses.some(isPrivateAddress)) return "The relay can't reach private network addresses.";
  }
  return url;
}
