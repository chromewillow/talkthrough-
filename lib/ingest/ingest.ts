import "server-only";

import { Readable, Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar-stream";

import { ArchiveError, fetchRepoArchive, MAX_ARCHIVE_BYTES, tooLargeMessage, tooManyFilesMessage } from "@/lib/github/archive";
import { parseRepoUrl, refCandidates, type RepoTarget } from "@/lib/github/parse-url";
import { analyzeFiles, findReadme } from "./analyze";
import { basenameOf, classifyPath, decodeText, extensionOf, looksGenerated, MAX_FILE_BYTES, notebookToText } from "./filters";
import { GitignoreSet, LinguistHints } from "./gitignore";
import type { IngestResult, RepoFile, SkippedEntry, SkipReason } from "./types";

/** Total text (UTF-8 bytes) we hand to the browser. Keeps the response well under serverless payload limits. */
export const MAX_TOTAL_BYTES = 3_000_000;
/** Most files we'll keep, however small. */
export const MAX_FILES = 2_000;
/** Most skipped entries we list one by one. */
const MAX_LISTED_SKIPS = 2_500;
/** Archive entries we'll walk before giving up. */
const MAX_ENTRIES = 200_000;
/** Decompressed bytes we'll inflate, so a tiny archive can't expand forever. */
const MAX_INFLATED_BYTES = 1_500_000_000;
/** Ignore-rule files we'll read, and their total size. */
const MAX_IGNORE_FILES = 200;
const MAX_IGNORE_BYTES = 2_000_000;
/** Ignore rules across all files: matching cost grows with them, and real repos use a few hundred. */
const MAX_IGNORE_RULES = 3_000;
/** Whole-ingest deadline, inside the route's time limit. */
const DEADLINE_MS = 50_000;

/** Project files outside a chosen subfolder that still shape how it's understood. */
const CONTEXT_CONFIGS = new Set(["package.json", "tsconfig.json", "jsconfig.json", "go.mod", "pyproject.toml", "composer.json", "pubspec.yaml"]);

export class IngestError extends Error {
  constructor(
    public code: "not_found" | "too_large" | "empty" | "github_rate_limited" | "github_unreachable",
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

type Candidate = { path: string; size: number; content: string };

type WalkResult = {
  /** Files to narrate, with full repository paths. */
  candidates: Candidate[];
  /** Config files from folders above the chosen subfolder, for analysis only. */
  context: Candidate[];
  skipped: SkippedEntry[];
  unlistedSkipped: number;
  totalEntries: number;
  gitignores: GitignoreSet;
  linguist: LinguistHints;
};

export async function ingestRepo(input: string, opts: { token?: string; signal?: AbortSignal } = {}): Promise<IngestResult> {
  const target = parseRepoUrl(input);
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(DEADLINE_MS)]) : AbortSignal.timeout(DEADLINE_MS);
  // Timers can't interrupt synchronous work, so the filtering step checks the clock itself.
  const deadline = Date.now() + DEADLINE_MS;
  try {
    const { stream, ref, subpath } = await openArchive(target, { token: opts.token, signal });
    const walk = await walkArchive(stream, subpath, signal);
    return finish(target, ref, subpath, walk, deadline);
  } catch (err) {
    if (signal.aborted && !opts.signal?.aborted && !(err instanceof IngestError && err.code !== "github_unreachable")) {
      throw new IngestError("too_large", TOO_SLOW);
    }
    throw err;
  }
}

async function openArchive(target: RepoTarget, opts: { token?: string; signal?: AbortSignal }) {
  const candidates = refCandidates(target);
  let lastError: unknown;
  for (const { ref, subpath } of candidates) {
    try {
      const stream = await fetchRepoArchive({ owner: target.owner, repo: target.repo, ref, token: opts.token, signal: opts.signal });
      return { stream, ref, subpath };
    } catch (err) {
      lastError = err;
      // A missing ref means "try a longer branch name"; anything else is final.
      if (!(err instanceof ArchiveError && err.code === "not_found")) break;
    }
  }
  // Every branch reading failed: tell a wrong branch apart from a missing repository.
  if (target.treeSegments.length && lastError instanceof ArchiveError && lastError.code === "not_found") {
    try {
      const stream = await fetchRepoArchive({ owner: target.owner, repo: target.repo, ref: "HEAD", token: opts.token, signal: opts.signal });
      await stream.cancel();
      throw new IngestError(
        "not_found",
        "We found the repository, but not the branch or folder in that link. Check it, or paste the plain repository link.",
      );
    } catch (err) {
      if (err instanceof IngestError) throw err;
    }
  }
  throw toIngestError(lastError);
}

function toIngestError(err: unknown): unknown {
  if (!(err instanceof ArchiveError)) return err;
  switch (err.code) {
    case "not_found":
      return new IngestError("not_found", err.message);
    case "rate_limited":
      return new IngestError("github_rate_limited", err.message);
    case "too_large":
      return new IngestError("too_large", err.message);
    default:
      return new IngestError("github_unreachable", err.message);
  }
}

function dirOf(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

async function walkArchive(body: ReadableStream<Uint8Array>, subpath: string, signal: AbortSignal): Promise<WalkResult> {
  const candidates: Candidate[] = [];
  const context: Candidate[] = [];
  const skipped: SkippedEntry[] = [];
  const skippedDirs = new Set<string>();
  let unlistedSkipped = 0;
  let totalEntries = 0;
  let keptBytes = 0;
  let ignoreFiles = 0;
  let ignoreBytes = 0;
  let ignoreRules = 0;
  const gitignores = new GitignoreSet();
  const linguist = new LinguistHints();
  const prefix = subpath ? `${subpath.replace(/\/+$/, "")}/` : "";
  /** True for a folder above the chosen subfolder (or the repo root). */
  const isAncestor = (dir: string) => !prefix || dir === "" || prefix.startsWith(`${dir}/`);

  const skip = (entry: SkippedEntry) => {
    if (skipped.length < MAX_LISTED_SKIPS) skipped.push(entry);
    else unlistedSkipped++;
  };

  let downloaded = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      downloaded += chunk.length;
      if (downloaded > MAX_ARCHIVE_BYTES) cb(new ArchiveError("too_large", tooLargeMessage()));
      else cb(null, chunk);
    },
  });
  let inflated = 0;
  const inflatedCounter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      inflated += chunk.length;
      if (inflated > MAX_INFLATED_BYTES) cb(new ArchiveError("too_large", tooLargeMessage()));
      else cb(null, chunk);
    },
  });

  const extractor = tarExtract();
  const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  const gunzip = createGunzip();
  const fail = (err: Error) => extractor.destroy(err);
  for (const s of [source, counter, gunzip, inflatedCounter]) s.on("error", fail);
  const onAbort = () => fail(new IngestError("github_unreachable", "Stopped."));
  signal.addEventListener("abort", onAbort, { once: true });
  source.pipe(counter).pipe(gunzip).pipe(inflatedCounter).pipe(extractor);

  try {
    for await (const entry of extractor) {
      const header = entry.header;
      // GitHub tarballs wrap everything in "<repo>-<sha>/".
      const full = header.name.replace(/^[^/]*\/?/, "");
      if (header.type !== "file" || !full) {
        entry.resume();
        continue;
      }
      const base = basenameOf(full);
      const size = header.size ?? 0;
      const dir = dirOf(full);
      const inside = !prefix || full.startsWith(prefix);

      // Ignore rules (from the subfolder or any folder above it) are read before anything else is decided.
      if ((base === ".gitignore" || base === ".gitattributes") && (inside || isAncestor(dir))) {
        if (size < 200_000 && ignoreFiles < MAX_IGNORE_FILES && ignoreBytes + size <= MAX_IGNORE_BYTES) {
          ignoreFiles++;
          ignoreBytes += size;
          const decoded = decodeText(await readEntry(entry));
          const text = decoded === null ? null : withinRuleBudget(decoded, MAX_IGNORE_RULES - ignoreRules);
          if (text) {
            ignoreRules += countRules(text);
            if (base === ".gitignore") gitignores.add(full, text);
            else linguist.add(full, text);
          }
        } else entry.resume();
        continue;
      }

      if (!inside) {
        // Configuration above the subfolder still tells us about aliases and dependencies.
        if (CONTEXT_CONFIGS.has(base) && isAncestor(dir) && size < 200_000) {
          const text = decodeText(await readEntry(entry));
          if (text !== null) context.push({ path: full, size, content: text });
        } else entry.resume();
        continue;
      }

      const path = full.slice(prefix.length);
      totalEntries++;
      if (totalEntries > MAX_ENTRIES) {
        entry.resume();
        throw new IngestError("too_large", tooManyFilesMessage());
      }

      const verdict = classifyPath(path, size);
      if (!verdict.keep) {
        entry.resume();
        if (verdict.dirDepth !== undefined) {
          const skippedDir = path.split("/").slice(0, verdict.dirDepth + 1).join("/");
          if (!skippedDirs.has(skippedDir)) {
            skippedDirs.add(skippedDir);
            skip({ path: skippedDir, reason: verdict.reason, isDir: true });
          }
        } else {
          skip({ path, reason: verdict.reason });
        }
        continue;
      }

      if (candidates.length >= MAX_FILES || keptBytes > MAX_TOTAL_BYTES * 3) {
        entry.resume();
        skip({ path, reason: "limit" });
        continue;
      }

      const buf = await readEntry(entry, MAX_FILE_BYTES + 1);
      let text = decodeText(buf);
      if (text === null) {
        skip({ path, reason: "binary" });
        continue;
      }
      if (extensionOf(path) === "ipynb") {
        text = notebookToText(text);
        if (text === null) {
          skip({ path, reason: "data" });
          continue;
        }
      }
      if (!text.trim()) {
        skip({ path, reason: "empty" });
        continue;
      }
      if (looksGenerated(path, text)) {
        skip({ path, reason: "generated" });
        continue;
      }
      keptBytes += Buffer.byteLength(text);
      candidates.push({ path: full, size, content: text });
    }
  } catch (err) {
    source.destroy();
    if (err instanceof IngestError) throw err;
    if (err instanceof ArchiveError) throw toIngestError(err);
    throw new IngestError("github_unreachable", "The download from GitHub was interrupted. Try again in a moment.");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  return { candidates, context, skipped, unlistedSkipped, totalEntries, gitignores, linguist };
}

async function readEntry(entry: AsyncIterable<unknown>, limit = Infinity): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of entry) {
    const chunk = raw as Buffer;
    if (total < limit) {
      chunks.push(chunk);
      total += chunk.length;
    }
  }
  return Buffer.concat(chunks).subarray(0, Math.min(total, limit));
}

const isRule = (line: string) => line.trim() !== "" && !line.trimStart().startsWith("#");

function countRules(text: string) {
  return text.split("\n").filter(isRule).length;
}

/** The file's text, cut off once the remaining rule budget is used up. */
function withinRuleBudget(text: string, remaining: number): string | null {
  if (remaining <= 0) return null;
  const lines = text.split("\n");
  let rules = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isRule(lines[i]) && ++rules > remaining) return lines.slice(0, i).join("\n");
  }
  return text;
}

const TOO_SLOW = "That repository took too long to read. Try pointing at a subfolder, like github.com/owner/repo/tree/main/src.";

function finish(target: RepoTarget, ref: string, subpath: string, walk: WalkResult, deadline = Infinity): IngestResult {
  const { gitignores, linguist } = walk;
  const prefix = subpath ? `${subpath.replace(/\/+$/, "")}/` : "";
  const rel = (full: string) => full.slice(prefix.length);
  const skipped = [...walk.skipped];
  let unlistedSkipped = walk.unlistedSkipped;
  const skip = (entry: SkippedEntry) => {
    if (skipped.length < MAX_LISTED_SKIPS) skipped.push(entry);
    else unlistedSkipped++;
  };

  const kept: Candidate[] = [];
  for (const [i, c] of walk.candidates.entries()) {
    if (i % 50 === 0 && Date.now() > deadline) throw new IngestError("too_large", TOO_SLOW);
    if (gitignores.ignores(c.path)) skip({ path: rel(c.path), reason: "gitignored" });
    else if (linguist.isGenerated(c.path)) skip({ path: rel(c.path), reason: "generated" });
    else kept.push(c);
  }

  if (kept.length === 0) {
    throw new IngestError(
      "empty",
      subpath
        ? `We didn't find any readable source files in the "${subpath}" folder.`
        : "We didn't find any readable source files in that repository — it may only contain assets, data or binaries.",
    );
  }

  // Analyse with full repository paths (so roles like "app router page" still
  // apply inside a subfolder), alongside config from the folders above it.
  const keptPaths = new Set(kept.map((c) => c.path));
  const analyzedFull = analyzeFiles([...kept, ...walk.context.filter((c) => !keptPaths.has(c.path))]).filter((f) => keptPaths.has(f.path));
  const analyzed: RepoFile[] = analyzedFull.map((f) => ({
    ...f,
    path: rel(f.path),
    imports: f.imports.filter((p) => keptPaths.has(p)).map(rel),
    importedBy: f.importedBy.filter((p) => keptPaths.has(p)).map(rel),
  }));
  const readmePath = findReadme(analyzed.map((f) => f.path));

  // Trim to the byte budget, keeping the most central files.
  const notes: string[] = [];
  let files: RepoFile[] = analyzed;
  const bytesOf = (f: RepoFile) => Buffer.byteLength(f.content);
  const totalBytes = analyzed.reduce((n, f) => n + bytesOf(f), 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    const ranked = [...analyzed].sort((a, b) => {
      if (a.path === readmePath) return -1;
      if (b.path === readmePath) return 1;
      return b.importance - a.importance || a.content.length - b.content.length;
    });
    const keep = new Set<string>();
    let used = 0;
    for (const f of ranked) {
      if (used + bytesOf(f) > MAX_TOTAL_BYTES) continue;
      keep.add(f.path);
      used += bytesOf(f);
    }
    const dropped = analyzed.filter((f) => !keep.has(f.path));
    dropped.forEach((f) => skip({ path: f.path, reason: "limit" }));
    files = analyzed.filter((f) => keep.has(f.path));
    // Imports pointing at dropped files no longer resolve to anything we can show.
    for (const f of files) {
      f.imports = f.imports.filter((p) => keep.has(p));
      f.importedBy = f.importedBy.filter((p) => keep.has(p));
    }
    notes.push(
      `This repository is large, so we kept the ${files.length} most central files and set aside ${dropped.length} others.`,
    );
  }
  if (walk.candidates.length >= MAX_FILES) {
    notes.push(`We stopped reading after ${MAX_FILES.toLocaleString("en-US")} source files.`);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const skippedSorted = skipped.sort((a, b) => a.path.localeCompare(b.path));

  return {
    repo: {
      owner: target.owner,
      repo: target.repo,
      ref,
      subpath,
      htmlUrl:
        `https://github.com/${target.owner}/${target.repo}` +
        (ref !== "HEAD" || subpath ? `/tree/${ref === "HEAD" ? "HEAD" : ref}${subpath ? `/${subpath}` : ""}` : ""),
    },
    files,
    skipped: skippedSorted,
    readmePath,
    stats: {
      totalEntries: walk.totalEntries,
      includedFiles: files.length,
      includedBytes: files.reduce((n, f) => n + bytesOf(f), 0),
      skippedEntries: skippedSorted.length + unlistedSkipped,
      unlistedSkipped,
    },
    notes,
  };
}

export type { SkipReason };
