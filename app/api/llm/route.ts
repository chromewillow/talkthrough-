import { checkRelayTarget } from "@/lib/server/relay-guard";

/**
 * A stateless relay for model providers that refuse requests from browsers
 * (no CORS headers). It forwards one chat completion request and streams the
 * answer back. The API key passes through in the Authorization header and is
 * never logged or stored.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 2_000_000;

function refuse(status: number, message: string) {
  return Response.json(
    { error: { message } },
    { status, headers: { "x-talkthrough-relay": "refused", "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth) return refuse(401, "Missing API key.");

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return refuse(413, "That request is too large to relay.");

  let body: { baseUrl?: unknown; payload?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return refuse(413, "That request is too large to relay.");
    body = JSON.parse(text);
  } catch {
    return refuse(400, "The relay expects a JSON body.");
  }
  if (!body.payload || typeof body.payload !== "object") return refuse(400, "Missing request payload.");

  const target = await checkRelayTarget(body.baseUrl);
  if (typeof target === "string") return refuse(400, target);

  const endpoint = `${target.toString().replace(/\/+$/, "")}/chat/completions`;
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body.payload),
      redirect: "manual",
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return refuse(502, `Couldn't connect to ${target.host}. Check the base URL.`);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    return refuse(502, `${target.host} tried to redirect the request. Check the base URL — it may need a /v1 at the end.`);
  }

  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const h of ["content-type", "retry-after", "x-ratelimit-reset", "x-ratelimit-reset-requests", "x-ratelimit-remaining"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
