/**
 * Turns whatever the user pasted into a GitHub owner / repo pair, plus an
 * optional branch and subfolder.
 *
 * Accepts the shapes people actually paste:
 *   https://github.com/owner/repo
 *   github.com/owner/repo.git
 *   owner/repo
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo/tree/main/packages/web
 *   https://github.com/owner/repo/blob/main/src/index.ts
 */

export type RepoTarget = {
  owner: string;
  repo: string;
  /**
   * Path segments that came after /tree/ or /blob/. The first one (or few)
   * name a branch, the rest a folder — GitHub URLs are ambiguous when branch
   * names contain slashes, so the ingester resolves the split.
   */
  treeSegments: string[];
  /** True when the URL pointed at a single file (/blob/...). */
  pointsAtFile: boolean;
};

export class RepoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoUrlError";
  }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

// Paths under github.com/<x> that are product pages, not users.
const RESERVED_OWNERS = new Set([
  "orgs",
  "settings",
  "marketplace",
  "explore",
  "topics",
  "collections",
  "trending",
  "sponsors",
  "features",
  "pricing",
  "login",
  "join",
  "notifications",
  "new",
  "search",
  "apps",
]);

export function parseRepoUrl(raw: string): RepoTarget {
  let input = raw.trim();
  if (!input) throw new RepoUrlError("Paste a GitHub repository link to get started.");

  // SSH form: git@github.com:owner/repo.git
  const ssh = input.match(/^git@github\.com:(.+)$/i);
  if (ssh) input = `https://github.com/${ssh[1]}`;

  let path: string;
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/.test(input)) {
    // Bare "owner/repo".
    path = input;
  } else {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new RepoUrlError("That doesn't look like a link. Try something like github.com/owner/repo.");
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "github.com") {
      throw new RepoUrlError(
        "Talkthrough only reads GitHub repositories for now. Paste a github.com link.",
      );
    }
    path = url.pathname;
  }

  const segments = path
    .split("/")
    .filter(Boolean)
    .map((s) => safeDecode(s));

  if (segments.length < 2) {
    throw new RepoUrlError(
      "That link points at a GitHub user or page, not a repository. It should look like github.com/owner/repo.",
    );
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");

  if (!OWNER_RE.test(owner) || RESERVED_OWNERS.has(owner.toLowerCase())) {
    throw new RepoUrlError(`"${owner}" isn't a valid GitHub owner name.`);
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new RepoUrlError(`"${repo}" isn't a valid repository name.`);
  }

  const rest = segments.slice(2);
  let treeSegments: string[] = [];
  let pointsAtFile = false;
  if ((rest[0] === "tree" || rest[0] === "blob") && rest.length > 1) {
    treeSegments = rest.slice(1);
    // Encoded slashes or dot segments could walk the download URL somewhere else.
    if (treeSegments.some((s) => s === "." || s === ".." || /[/\\]/.test(s) || s.includes(".."))) {
      throw new RepoUrlError("That link has a branch or folder name we can't use. Try the plain repository link.");
    }
    pointsAtFile = rest[0] === "blob";
  }

  return { owner, repo, treeSegments, pointsAtFile };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Candidate (ref, subpath) splits for /tree/<segments>, most likely first.
 * A branch called "feature/login" makes "/tree/feature/login/src" ambiguous,
 * so we try the one-segment branch first and widen from there.
 */
export function refCandidates(target: RepoTarget): { ref: string; subpath: string }[] {
  const segs = target.treeSegments;
  if (segs.length === 0) return [{ ref: "HEAD", subpath: "" }];
  const out: { ref: string; subpath: string }[] = [];
  const maxRefDepth = Math.min(segs.length, 4);
  for (let i = 1; i <= maxRefDepth; i++) {
    let subpathSegs = segs.slice(i);
    // A /blob/ link names a file — narrate the folder that holds it.
    if (target.pointsAtFile) subpathSegs = subpathSegs.slice(0, -1);
    out.push({ ref: segs.slice(0, i).join("/"), subpath: subpathSegs.join("/") });
  }
  return out;
}
