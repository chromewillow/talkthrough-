import type { RepoFile, SkippedEntry, SkipReason } from "@/lib/ingest/types";

export type TreeFileNode = {
  kind: "file";
  name: string;
  path: string;
  file?: Pick<RepoFile, "path" | "lines" | "language" | "category">;
  skipped?: SkipReason;
};

export type TreeDirNode = {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
  /** Set when the whole folder was skipped (e.g. node_modules). */
  skipped?: SkipReason;
  included: number;
  skippedCount: number;
};

export type TreeNode = TreeFileNode | TreeDirNode;

function newDir(name: string, path: string): TreeDirNode {
  return { kind: "dir", name, path, children: [], included: 0, skippedCount: 0 };
}

/** Builds a folder tree from included files and skipped entries. */
export function buildTree(files: TreeFileNode["file"][], skipped: SkippedEntry[], { includeSkipped = true } = {}): TreeDirNode {
  const root = newDir("", "");
  const dirs = new Map<string, TreeDirNode>([["", root]]);

  const ensureDir = (path: string): TreeDirNode => {
    const existing = dirs.get(path);
    if (existing) return existing;
    const i = path.lastIndexOf("/");
    const parent = ensureDir(i === -1 ? "" : path.slice(0, i));
    const dir = newDir(i === -1 ? path : path.slice(i + 1), path);
    parent.children.push(dir);
    dirs.set(path, dir);
    return dir;
  };

  const parentOf = (path: string) => {
    const i = path.lastIndexOf("/");
    return ensureDir(i === -1 ? "" : path.slice(0, i));
  };

  for (const f of files) {
    if (!f) continue;
    parentOf(f.path).children.push({ kind: "file", name: f.path.slice(f.path.lastIndexOf("/") + 1), path: f.path, file: f });
  }

  if (includeSkipped) {
    for (const s of skipped) {
      if (s.isDir) {
        const dir = ensureDir(s.path);
        dir.skipped = s.reason;
      } else {
        parentOf(s.path).children.push({ kind: "file", name: s.path.slice(s.path.lastIndexOf("/") + 1), path: s.path, skipped: s.reason });
      }
    }
  }

  countAndSort(root);
  return compact(root);
}

function countAndSort(dir: TreeDirNode) {
  dir.included = 0;
  dir.skippedCount = dir.skipped ? 1 : 0;
  for (const child of dir.children) {
    if (child.kind === "dir") {
      countAndSort(child);
      dir.included += child.included;
      dir.skippedCount += child.skippedCount;
    } else if (child.skipped) dir.skippedCount++;
    else dir.included++;
  }
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/** Folds single-child folder chains into one row: "src/lib/utils". */
function compact(dir: TreeDirNode): TreeDirNode {
  dir.children = dir.children.map((child) => {
    if (child.kind !== "dir") return child;
    let node = child;
    while (!node.skipped && node.children.length === 1 && node.children[0].kind === "dir" && !node.children[0].skipped) {
      const only = node.children[0];
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    return compact(node);
  });
  return dir;
}

/** Folder paths to open by default: everything when small, the top levels when large. */
export function defaultOpenPaths(root: TreeDirNode): Set<string> {
  const open = new Set<string>();
  const total = root.included + root.skippedCount;
  const maxDepth = total <= 60 ? Infinity : total <= 250 ? 1 : 0;
  const walk = (dir: TreeDirNode, depth: number) => {
    for (const child of dir.children) {
      if (child.kind !== "dir" || child.skipped || child.included === 0) continue;
      if (depth <= maxDepth) open.add(child.path);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return open;
}
