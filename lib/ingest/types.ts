/**
 * Shapes shared by the server-side ingester and the browser. Everything here
 * must stay JSON-serialisable: it travels over the /api/ingest response.
 */

export type FileCategory =
  | "entry" // where the app starts: main files, root layouts, servers
  | "route" // pages, API routes, controllers — the app's surface
  | "core" // business logic, data, state, services
  | "component" // UI building blocks
  | "helper" // utilities, hooks, shared types, constants
  | "script" // build / maintenance scripts
  | "style" // stylesheets
  | "config" // tooling and project configuration
  | "test" // tests and fixtures
  | "docs" // prose documentation
  | "data"; // small data / content files

export type RepoFile = {
  path: string;
  /** Bytes of the original file. */
  size: number;
  lines: number;
  language: string;
  category: FileCategory;
  isEntry: boolean;
  /** Paths (within this repo) that this file imports. */
  imports: string[];
  /** Paths (within this repo) that import this file. */
  importedBy: string[];
  /** Relative weight used for ordering and trimming — higher is more central. */
  importance: number;
  content: string;
};

export type SkipReason =
  | "dependencies"
  | "build-output"
  | "cache"
  | "editor"
  | "version-control"
  | "housekeeping"
  | "lockfile"
  | "asset"
  | "binary"
  | "generated"
  | "too-large"
  | "gitignored"
  | "secret"
  | "data"
  | "empty"
  | "limit";

export type SkippedEntry = {
  path: string;
  reason: SkipReason;
  /** True when a whole folder was skipped (we don't list its contents). */
  isDir?: boolean;
};

export type RepoInfo = {
  owner: string;
  repo: string;
  /** Branch, tag or commit we read. "HEAD" means the default branch. */
  ref: string;
  /** Folder inside the repo the user pointed at, if any. */
  subpath: string;
  htmlUrl: string;
};

export type IngestResult = {
  repo: RepoInfo;
  files: RepoFile[];
  skipped: SkippedEntry[];
  /** Path of the README we found (also present in files), for context. */
  readmePath: string | null;
  stats: {
    /** Every file entry seen in the archive (after the subfolder filter). */
    totalEntries: number;
    includedFiles: number;
    includedBytes: number;
    skippedEntries: number;
    /** Skipped entries beyond what we list individually. */
    unlistedSkipped: number;
  };
  /** Plain-English notes about limits we applied. */
  notes: string[];
};

export type IngestErrorCode =
  | "invalid_url"
  | "not_found"
  | "too_large"
  | "empty"
  | "github_rate_limited"
  | "github_unreachable"
  | "internal";

export type IngestErrorBody = {
  error: { code: IngestErrorCode; message: string };
};

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  dependencies: "dependencies",
  "build-output": "build output",
  cache: "cache",
  editor: "editor settings",
  "version-control": "version control",
  housekeeping: "housekeeping",
  lockfile: "lockfile",
  asset: "asset",
  binary: "binary",
  generated: "generated",
  "too-large": "too large",
  gitignored: "gitignored",
  secret: "possible secrets",
  data: "data file",
  empty: "empty",
  limit: "over size budget",
};
