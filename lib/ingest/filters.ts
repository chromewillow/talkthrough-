/**
 * Decides which files in a repository are worth explaining.
 *
 * The defaults follow gitingest's ignore list (coderamp-labs/gitingest), tuned
 * for narration: we also drop assets, lockfiles, likely secrets and generated
 * code, and we keep folders like `bin/` and `pkg/` that hold real source in
 * Node CLIs and Go projects.
 */
import type { SkipReason } from "./types";

/** Largest single file we'll read. Bigger files are almost always data or generated. */
export const MAX_FILE_BYTES = 160_000;

/** Folder names skipped wherever they appear, with the reason we show. */
const IGNORED_DIRS: Record<string, SkipReason> = {
  node_modules: "dependencies",
  bower_components: "dependencies",
  jspm_packages: "dependencies",
  vendor: "dependencies",
  Pods: "dependencies",
  Carthage: "dependencies",
  "site-packages": "dependencies",
  ".venv": "dependencies",
  venv: "dependencies",
  virtualenv: "dependencies",
  ".bundle": "dependencies",
  ".yarn": "dependencies",
  ".pnpm-store": "dependencies",
  ".npm": "dependencies",
  "elm-stuff": "dependencies",
  ".dart_tool": "dependencies",
  ".pub-cache": "dependencies",
  ".terraform": "dependencies",
  ".eggs": "dependencies",
  deps: "dependencies",

  dist: "build-output",
  build: "build-output",
  out: "build-output",
  target: "build-output",
  _build: "build-output",
  ".next": "build-output",
  ".nuxt": "build-output",
  ".output": "build-output",
  ".svelte-kit": "build-output",
  ".vercel": "build-output",
  ".netlify": "build-output",
  ".expo": "build-output",
  ".angular": "build-output",
  ".docusaurus": "build-output",
  "storybook-static": "build-output",
  DerivedData: "build-output",
  ".build": "build-output",
  ".gradle": "build-output",
  ".serverless": "build-output",
  ".stack-work": "build-output",
  coverage: "build-output",
  ".nyc_output": "build-output",
  __snapshots__: "generated",

  __pycache__: "cache",
  ".pytest_cache": "cache",
  ".mypy_cache": "cache",
  ".ruff_cache": "cache",
  ".hypothesis": "cache",
  ".tox": "cache",
  ".nox": "cache",
  ".cache": "cache",
  ".parcel-cache": "cache",
  ".turbo": "cache",
  ".sass-cache": "cache",
  ".eslintcache": "cache",

  ".idea": "editor",
  ".vscode": "editor",
  ".vs": "editor",
  ".fleet": "editor",
  xcuserdata: "editor",
  ".settings": "editor",

  ".git": "version-control",
  ".svn": "version-control",
  ".hg": "version-control",
};

/** Folder-name suffixes skipped wherever they appear. */
const IGNORED_DIR_SUFFIXES: [string, SkipReason][] = [
  [".egg-info", "build-output"],
  [".xcodeproj", "editor"],
  [".xcworkspace", "editor"],
  [".xcassets", "asset"],
];

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
  "go.work.sum",
  "mix.lock",
  "pubspec.lock",
  "podfile.lock",
  "packages.lock.json",
  "flake.lock",
  "gradle.lockfile",
  ".terraform.lock.hcl",
  "package.resolved",
]);

const ASSET_EXTENSIONS = new Set([
  // images
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "tif", "tiff",
  "psd", "ai", "eps", "heic", "heif", "svg", "raw", "cr2", "nef", "dng", "xcf",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // audio
  "mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "opus", "mid", "midi", "aiff",
  // video
  "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv", "mpg", "mpeg",
  // 3d / design
  "glb", "gltf", "fbx", "blend", "stl", "usdz", "3ds", "dae", "sketch", "fig", "xd",
  // documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages",
  "odt", "ods", "odp", "rtf", "epub",
]);

const BINARY_EXTENSIONS = new Set([
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst", "lz4",
  "jar", "war", "ear", "nar", "whl", "egg", "gem", "nupkg", "apk", "aab", "ipa",
  "dmg", "iso", "deb", "rpm", "msi", "pkg", "exe", "dll", "so", "dylib", "a",
  "o", "obj", "lib", "bin", "dat", "class", "pyc", "pyo", "pyd", "wasm", "node",
  "pdb", "ilk", "exp", "out", "elf", "dSYM",
  "sqlite", "sqlite3", "db", "mdb", "accdb", "parquet", "feather", "arrow",
  "npy", "npz", "pkl", "pickle", "h5", "hdf5", "onnx", "pt", "pth", "ckpt",
  "safetensors", "tflite", "mlmodel", "keras", "joblib",
  "ds_store", "swp", "swo",
]);

const DATA_EXTENSIONS = new Set(["csv", "tsv", "jsonl", "ndjson", "geojson", "sql.gz"]);

const SECRET_NAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials.json",
  "service-account.json",
  ".htpasswd",
]);

const SECRET_EXTENSIONS = new Set(["pem", "key", "p12", "pfx", "jks", "keystore", "crt", "cer", "der", "asc", "gpg"]);

const NOISE_EXTENSIONS = new Set(["log", "tmp", "temp", "bak", "orig", "rej", "swp", "pid"]);

const NOISE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini", "digest.txt"]);

/** Housekeeping files that say nothing about how the app works. */
const HOUSEKEEPING_NAMES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".gitkeep",
  ".keep",
  ".npmignore",
  ".dockerignore",
  ".eslintignore",
  ".prettierignore",
  ".vercelignore",
  ".gcloudignore",
  ".slugignore",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".ruby-version",
  ".ruby-gemset",
  ".tool-versions",
  ".rvmrc",
  ".mailmap",
  "codeowners",
  "license",
  "license.md",
  "license.txt",
  "licence",
  "licence.md",
  "copying",
  "notice",
  "authors",
  "contributors",
  "changelog.md",
  "changelog",
  "history.md",
  "code_of_conduct.md",
  "security.md",
  "funding.yml",
  "pull_request_template.md",
  "issue_template.md",
  "support.md",
]);

/** Folders full of repository housekeeping rather than app code. */
const HOUSEKEEPING_DIRS = /(^|\/)\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE|DISCUSSION_TEMPLATE)\//i;

export type PathVerdict =
  | { keep: true }
  | { keep: false; reason: SkipReason; /** Index of the path segment that triggered a folder skip. */ dirDepth?: number };

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Path-only checks, run before we read a file's bytes. */
export function classifyPath(path: string, size: number): PathVerdict {
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const hit = IGNORED_DIRS[seg];
    if (hit) return { keep: false, reason: hit, dirDepth: i };
    for (const [suffix, reason] of IGNORED_DIR_SUFFIXES) {
      if (seg.endsWith(suffix)) return { keep: false, reason, dirDepth: i };
    }
  }

  const base = segments[segments.length - 1];
  const lower = base.toLowerCase();
  const ext = extensionOf(base);

  if (LOCKFILES.has(lower)) return { keep: false, reason: "lockfile" };
  if (NOISE_NAMES.has(lower) || NOISE_EXTENSIONS.has(ext)) return { keep: false, reason: "cache" };
  if (HOUSEKEEPING_NAMES.has(lower) || HOUSEKEEPING_DIRS.test(path)) return { keep: false, reason: "housekeeping" };
  if (isLikelySecret(lower, ext)) return { keep: false, reason: "secret" };
  if (ASSET_EXTENSIONS.has(ext)) return { keep: false, reason: "asset" };
  if (BINARY_EXTENSIONS.has(ext)) return { keep: false, reason: "binary" };
  if (DATA_EXTENSIONS.has(ext)) return { keep: false, reason: "data" };
  if (/\.(min|bundle|chunk)\.(js|css|mjs)$/i.test(lower) || ext === "map") {
    return { keep: false, reason: "generated" };
  }
  if (/\.(pb|pb2|g|generated|gen)\.(go|py|ts|js|dart|cs)$/i.test(lower) || lower.endsWith("_pb2.py")) {
    return { keep: false, reason: "generated" };
  }
  if (lower === "next-env.d.ts" || lower.endsWith(".tsbuildinfo")) return { keep: false, reason: "generated" };
  if (size === 0) return { keep: false, reason: "empty" };
  if (size > MAX_FILE_BYTES) {
    // Big JSON/YAML/XML is data; anything else is just too big to narrate well.
    if (["json", "yaml", "yml", "xml", "txt"].includes(ext)) return { keep: false, reason: "data" };
    return { keep: false, reason: "too-large" };
  }
  if (["json", "xml"].includes(ext) && size > 60_000) return { keep: false, reason: "data" };
  return { keep: true };
}

function isLikelySecret(lower: string, ext: string): boolean {
  if (SECRET_NAMES.has(lower)) return true;
  if (SECRET_EXTENSIONS.has(ext)) return true;
  // .env, .env.local, .env.production … but keep the documented templates.
  if (lower === ".env" || lower.startsWith(".env.")) {
    return !/\.(example|sample|template|dist|defaults?)$/.test(lower);
  }
  if (lower.endsWith(".env") && lower !== ".env.example") return true;
  return false;
}

/**
 * Sniffs the bytes: NUL bytes or lots of invalid UTF-8 mean it isn't text.
 * Returns the decoded text, or null for binary.
 */
export function decodeText(buf: Uint8Array): string | null {
  const sample = buf.subarray(0, 8000);
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  let bad = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) bad++;
  if (bad > 8 && bad / Math.max(1, text.length) > 0.01) return null;
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** Content-based checks for machine-written files. */
export function looksGenerated(path: string, text: string): boolean {
  const head = text.slice(0, 600).toLowerCase();
  if (
    /@generated|do not edit|auto-?generated|autogenerated|this file (is|was) (automatically )?generated|generated by (the )?(protoc|prisma|graphql-codegen|openapi|swagger|sqlc|buf)/.test(
      head,
    )
  ) {
    // "DO NOT EDIT" banners sometimes guard hand-maintained config; only trust them on code.
    return !/\.(md|mdx|txt)$/i.test(path);
  }
  // Minified: very long lines with almost no line breaks.
  const lines = text.split("\n");
  if (text.length > 4000 && lines.length > 0) {
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    if (longest > 2000 && text.length / lines.length > 400) return true;
  }
  return false;
}

/** Jupyter notebooks: keep the cell sources, drop the outputs. */
export function notebookToText(raw: string): string | null {
  try {
    const nb = JSON.parse(raw) as { cells?: { cell_type?: string; source?: string | string[] }[] };
    if (!Array.isArray(nb.cells)) return null;
    return nb.cells
      .map((cell, i) => {
        const src = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");
        if (!src.trim()) return "";
        return cell.cell_type === "markdown"
          ? `# --- Cell ${i + 1} (notes) ---\n${src
              .split("\n")
              .map((l) => `# ${l}`)
              .join("\n")}`
          : `# --- Cell ${i + 1} (code) ---\n${src}`;
      })
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return null;
  }
}
