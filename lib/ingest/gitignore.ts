/**
 * Applies the repository's own .gitignore files (at any depth) and the
 * linguist hints in .gitattributes, the way git and GitHub would.
 */
import ignore, { type Ignore } from "ignore";

type Scoped = { dir: string; matcher: Ignore };

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function relativeTo(dir: string, path: string): string | null {
  if (!dir) return path;
  return path.startsWith(dir + "/") ? path.slice(dir.length + 1) : null;
}

export class GitignoreSet {
  private scopes: (Scoped & { depth: number })[] = [];
  private sorted = true;

  add(gitignorePath: string, contents: string) {
    const matcher = ignore({ allowRelativePaths: true }).add(contents);
    const dir = dirOf(gitignorePath);
    this.scopes.push({ dir, matcher, depth: depth(dir) });
    this.sorted = false;
  }

  get size() {
    return this.scopes.length;
  }

  ignores(path: string): boolean {
    if (!this.sorted) {
      // Shallow rules first so deeper files can override them, like git.
      this.scopes.sort((a, b) => a.depth - b.depth);
      this.sorted = true;
    }
    let ignored = false;
    for (const { dir, matcher } of this.scopes) {
      const rel = relativeTo(dir, path);
      if (rel === null) continue;
      const result = matcher.test(rel);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }
}

function depth(dir: string) {
  return dir ? dir.split("/").length : 0;
}

/** Files marked `linguist-generated` or `linguist-vendored` in .gitattributes. */
export class LinguistHints {
  private generated: Scoped[] = [];

  add(attributesPath: string, contents: string) {
    const patterns: string[] = [];
    for (const raw of contents.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [pattern, ...attrs] = line.split(/\s+/);
      const flagged = attrs.some((a) => /^linguist-(generated|vendored)(=true)?$/.test(a));
      if (flagged && pattern) patterns.push(pattern);
    }
    if (patterns.length) {
      this.generated.push({
        dir: dirOf(attributesPath),
        matcher: ignore({ allowRelativePaths: true }).add(patterns),
      });
    }
  }

  isGenerated(path: string): boolean {
    for (const { dir, matcher } of this.generated) {
      const rel = relativeTo(dir, path);
      if (rel !== null && matcher.ignores(rel)) return true;
    }
    return false;
  }
}
