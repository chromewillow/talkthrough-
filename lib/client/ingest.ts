import type { IngestErrorBody, IngestResult } from "@/lib/ingest/types";

export class FriendlyError extends Error {
  constructor(
    public title: string,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "FriendlyError";
  }
}

const TITLES: Record<string, string> = {
  invalid_url: "That link doesn't look right",
  not_found: "Repository not found",
  too_large: "That repository is too large",
  empty: "Nothing to narrate",
  github_rate_limited: "GitHub asked us to slow down",
  github_unreachable: "Couldn't reach GitHub",
  internal: "Something went wrong",
};

/** Asks our server to download and filter the repository. */
export async function ingest(url: string, signal?: AbortSignal): Promise<IngestResult> {
  let res: Response;
  try {
    res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new FriendlyError("You seem to be offline", "We couldn't reach the Talkthrough server. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as IngestErrorBody | null;
    const code = body?.error?.code ?? "internal";
    throw new FriendlyError(
      TITLES[code] ?? TITLES.internal,
      body?.error?.message ?? `The server answered with an error (${res.status}). Please try again.`,
      code,
    );
  }
  return (await res.json()) as IngestResult;
}
