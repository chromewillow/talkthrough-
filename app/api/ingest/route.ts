import { RepoUrlError } from "@/lib/github/parse-url";
import { IngestError, ingestRepo } from "@/lib/ingest/ingest";
import type { IngestErrorBody, IngestErrorCode } from "@/lib/ingest/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const STATUS: Record<IngestErrorCode, number> = {
  invalid_url: 400,
  not_found: 404,
  too_large: 413,
  empty: 422,
  github_rate_limited: 429,
  github_unreachable: 502,
  internal: 500,
};

function fail(code: IngestErrorCode, message: string) {
  const body: IngestErrorBody = { error: { code, message } };
  return Response.json(body, { status: STATUS[code] });
}

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = (await request.json()) as { url?: unknown });
  } catch {
    return fail("invalid_url", "Send a JSON body like { \"url\": \"github.com/owner/repo\" }.");
  }
  if (typeof url !== "string" || url.length > 500) {
    return fail("invalid_url", "Paste a GitHub repository link to get started.");
  }

  try {
    const result = await ingestRepo(url, {
      // Optional: a server-side token lifts GitHub's anonymous download limits.
      token: process.env.TALKTHROUGH_GITHUB_TOKEN || undefined,
      signal: request.signal,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof RepoUrlError) return fail("invalid_url", err.message);
    if (err instanceof IngestError) return fail(err.code, err.message);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("ingest failed", err instanceof Error ? err.message : err);
    return fail("internal", "Something went wrong while reading that repository. Please try again.");
  }
}
