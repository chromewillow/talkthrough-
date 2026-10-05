import "server-only";

/**
 * Downloads a repository snapshot as a single gzipped tarball.
 *
 * One request per repo, and codeload.github.com isn't subject to the REST
 * API's 60-requests-an-hour anonymous limit — which matters on shared
 * serverless IPs. When TALKTHROUGH_GITHUB_TOKEN is configured (or, later, when users
 * bring their own for private repos) we go through the authenticated API.
 */

export class ArchiveError extends Error {
  constructor(
    public code: "not_found" | "rate_limited" | "unreachable" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

export type ArchiveRequest = {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
  signal?: AbortSignal;
};

/** Hard ceiling on the compressed download. */
export const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;

function encodeRef(ref: string) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

export async function fetchRepoArchive(req: ArchiveRequest): Promise<ReadableStream<Uint8Array>> {
  const { owner, repo, ref, token, signal } = req;
  const codeloadBase = process.env.TALKTHROUGH_CODELOAD_BASE || "https://codeload.github.com";
  const url = token
    ? `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeRef(ref)}`
    : `${codeloadBase}/${owner}/${repo}/tar.gz/${encodeRef(ref)}`;

  const headers: Record<string, string> = { "User-Agent": "talkthrough" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.Accept = "application/vnd.github+json";
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal, redirect: "follow", cache: "no-store" });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ArchiveError("unreachable", "We couldn't reach GitHub just now. Give it a moment and try again.");
  }

  if (res.status === 404 || res.status === 401 || (res.status === 403 && !isRateLimit(res))) {
    await res.body?.cancel();
    throw new ArchiveError(
      "not_found",
      "We couldn't find a public GitHub repository at that address. Check the link, and note that private repositories aren't supported yet.",
    );
  }
  if (res.status === 429 || isRateLimit(res)) {
    await res.body?.cancel();
    throw new ArchiveError("rate_limited", "GitHub is rate-limiting downloads right now. Wait a minute and try again.");
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new ArchiveError("unreachable", `GitHub returned an unexpected response (${res.status}). Try again in a moment.`);
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) {
    await res.body.cancel();
    throw new ArchiveError("too_large", tooLargeMessage());
  }
  return res.body;
}

function isRateLimit(res: Response) {
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

export function tooLargeMessage() {
  return "That repository is too big to read in one go (over 150 MB compressed). Try pointing at a subfolder — paste a link like github.com/owner/repo/tree/main/src.";
}
