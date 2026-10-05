/**
 * Decides the shape of the tour: which files get their own section, how much
 * air time each gets, which minor files are grouped together, and in what
 * order the listener hears them — entry points and core logic first, helpers
 * and configuration last.
 */
import type { FileCategory, IngestResult, RepoFile } from "@/lib/ingest/types";
import { CHAPTER_TITLES, type ChapterKey, type Chunk, type Depth, type GroupKind, type GroupSection, type NarrationLength, type NarrationPlan, type PlanSection } from "./types";

export type Budget = {
  /** Most files that get a full-length section. */
  maxFull: number;
  /** Of those, how many large central files get extra room. */
  maxMajor: number;
  majorWords: [number, number];
  /** Most sections overall (files plus groups). */
  maxSections: number;
  fullWords: [number, number];
  briefWords: [number, number];
  groupWords: [number, number];
  overviewWords: [number, number];
  closingWords: [number, number];
  /** Characters of source per request before a file is split into parts. */
  chunkChars: number;
  /** Characters of source shown for a whole group. */
  groupChars: number;
  /** Characters of related code from linked files shown with each part. */
  relatedChars: number;
};

export const BUDGETS: Record<NarrationLength, Budget> = {
  short: {
    maxFull: 12,
    maxMajor: 4,
    majorWords: [200, 320],
    maxSections: 30,
    fullWords: [120, 200],
    briefWords: [40, 80],
    groupWords: [60, 120],
    overviewWords: [300, 450],
    closingWords: [180, 280],
    chunkChars: 24_000,
    groupChars: 24_000,
    relatedChars: 3500,
  },
  // Aims for roughly 45 to 75 minutes of listening on a mid-sized app.
  medium: {
    maxFull: 28,
    maxMajor: 6,
    majorWords: [320, 480],
    maxSections: 56,
    fullWords: [200, 300],
    briefWords: [60, 120],
    groupWords: [130, 210],
    overviewWords: [450, 700],
    closingWords: [300, 450],
    chunkChars: 24_000,
    groupChars: 30_000,
    relatedChars: 5000,
  },
  long: {
    maxFull: 80,
    maxMajor: 12,
    majorWords: [450, 700],
    maxSections: 140,
    fullWords: [280, 480],
    briefWords: [90, 170],
    groupWords: [140, 280],
    overviewWords: [700, 1000],
    closingWords: [400, 600],
    chunkChars: 24_000,
    groupChars: 36_000,
    relatedChars: 6000,
  },
};

/** Listening order: lower comes first. */
const TIER: Record<FileCategory, number> = {
  entry: 0,
  route: 1,
  core: 2,
  component: 3,
  helper: 4,
  script: 5,
  style: 6,
  data: 7,
  config: 8,
  test: 9,
  docs: 10,
};

const GROUP_META: Record<GroupKind, { title: string; description: string; tier: number }> = {
  "ui-kit": {
    title: "The interface building blocks",
    description:
      "a kit of small, reusable interface pieces — buttons, inputs, dialogs and the like — that the rest of the app assembles screens from (often generated from a component library such as shadcn/ui)",
    tier: 3.5,
  },
  migrations: {
    title: "Database migrations",
    description: "database migrations: the step-by-step history of how the database structure was created and changed",
    tier: 2.5,
  },
  styles: { title: "How it's styled", description: "the stylesheets that control how the app looks", tier: 6 },
  scripts: {
    title: "Helper scripts",
    description: "scripts a developer runs by hand or that run during builds — setup, maintenance and automation",
    tier: 5,
  },
  data: { title: "Data and content files", description: "data, content and settings files the app reads rather than code it runs", tier: 7 },
  config: {
    title: "How the project is set up",
    description:
      "the project's configuration: dependencies, build and framework settings, code-quality tools, deployment and automation",
    tier: 8,
  },
  tests: { title: "The tests", description: "the automated tests that check the app still works", tier: 9 },
  docs: { title: "The documentation", description: "written documentation and notes for people working on the project", tier: 10 },
  more: { title: "Everything else", description: "smaller files that round out this part of the app", tier: 0 },
};

const MORE_TITLES: Partial<Record<FileCategory, string>> = {
  entry: "Other starting points",
  route: "More pages and routes",
  core: "More of the core logic",
  component: "More interface pieces",
  helper: "More helpers",
  script: "More scripts",
};

/** Tiers are grouped into a handful of spoken chapters. */
export function chapterOf(tier: number): ChapterKey {
  if (tier < 2) return "start";
  if (tier < 3) return "core";
  if (tier < 4) return "interface";
  if (tier < 8) return "support";
  return "setup";
}

/** Files per group we show source for; the rest are listed by name. */
const MAX_GROUP_FILES = 30;
/** Largest "more of …" group before it's split by folder. */
const MAX_MORE_GROUP = 16;

function dirname(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function clusterKey(path: string) {
  return dirname(path).split("/").slice(0, 2).join("/");
}

/** Icon sets and other files that are mostly drawing data, not logic. */
function isMostlyMarkup(f: RepoFile): boolean {
  if (/(^|\/)icons?(\/|\.[jt]sx?$)/i.test(f.path)) return true;
  const paths = f.content.match(/<path\b/g)?.length ?? 0;
  return paths > 25 && paths > f.lines / 12;
}

function isUiKit(path: string) {
  return /(^|\/)components\/ui\//.test(path) || /(^|\/)ui\/primitives\//.test(path);
}

/**
 * Orders files inside one tier so related files sit together: files are
 * clustered by folder, clusters play in order of their most important file.
 */
function orderTier(files: RepoFile[], tier: FileCategory, reach: Map<string, number>): RepoFile[] {
  if (tier === "component") {
    // Screens in the order the app reaches them, so each feature's pieces play together.
    const unreached = files.filter((f) => !reach.has(f.path));
    const reached = files.filter((f) => reach.has(f.path)).sort((a, b) => reach.get(a.path)! - reach.get(b.path)!);
    return [...reached, ...clusterOrder(unreached, (a, b) => b.importance - a.importance || a.path.localeCompare(b.path))];
  }
  if (tier === "route") {
    // Screens before API endpoints, then by path so areas stay together.
    const isApi = (f: RepoFile) => /(^|\/)api\//.test(f.path) || /(^|\/)route\.[jt]s$/.test(f.path);
    return [...files].sort((a, b) => Number(isApi(a)) - Number(isApi(b)) || a.path.localeCompare(b.path));
  }
  if (tier === "entry") {
    // Root layouts before pages; otherwise in start-up order (what loads what).
    // The HTML page an entry script mounts into plays right after it.
    const rank = (f: RepoFile) =>
      /(^|\/)layout\.[jt]sx?$/.test(f.path) ? 0 : /(^|\/)page\.[jt]sx?$/.test(f.path) ? 1 : /\.html?$/.test(f.path) ? 3 : 2;
    const at = (f: RepoFile) => reach.get(f.path) ?? Number.MAX_SAFE_INTEGER;
    return [...files].sort((a, b) => rank(a) - rank(b) || at(a) - at(b) || b.importance - a.importance);
  }
  if (tier === "core") {
    // Foundations (most depended-on) before the files that build on them;
    // tiny re-export files don't count as foundations.
    const weight = (f: RepoFile) => f.importedBy.length * (f.lines >= 15 ? 1 : 0.3);
    return clusterOrder(files, (a, b) => weight(b) - weight(a) || b.importance - a.importance);
  }
  return clusterOrder(files, (a, b) => b.importance - a.importance || a.path.localeCompare(b.path));
}

function clusterOrder(files: RepoFile[], within: (a: RepoFile, b: RepoFile) => number): RepoFile[] {
  const clusters = new Map<string, RepoFile[]>();
  for (const f of files) {
    const key = clusterKey(f.path);
    clusters.set(key, [...(clusters.get(key) ?? []), f]);
  }
  return [...clusters.values()]
    .map((list) => ({ list: list.sort(within), top: Math.max(...list.map((f) => f.importance)) }))
    .sort((a, b) => b.top - a.top || a.list[0].path.localeCompare(b.list[0].path))
    .flatMap((c) => c.list);
}

/**
 * Splits long source into parts at natural boundaries — a blank line before
 * an unindented line, where top-level declarations usually start.
 */
export function chunkContent(text: string, maxChars: number): Chunk[] {
  const lines = text.split("\n");
  if (text.length <= maxChars) return [{ index: 0, total: 1, startLine: 1, endLine: lines.length, text }];

  const ranges: [number, number][] = [];
  let start = 0;
  while (start < lines.length) {
    let size = 0;
    let end = start;
    let bestBreak = -1;
    while (end < lines.length && size + lines[end].length + 1 <= maxChars) {
      size += lines[end].length + 1;
      // A good place to cut: a blank line followed by top-level code, past 60% of the budget.
      if (size > maxChars * 0.6 && lines[end].trim() === "" && end + 1 < lines.length && /^\S/.test(lines[end + 1])) {
        bestBreak = end + 1;
      }
      end++;
    }
    if (end === start) end = start + 1; // a single enormous line
    const cut = end < lines.length && bestBreak > start ? bestBreak : end;
    ranges.push([start, cut]);
    start = cut;
  }
  return ranges.map(([s, e], index) => ({
    index,
    total: ranges.length,
    startLine: s + 1,
    endLine: e,
    text: lines.slice(s, e).join("\n"),
  }));
}

const COMMENT_LINE = /^(\/\/|#|\/\*|\*|"""|''')/;
/** Lines that only wire other files together: re-exports, imports, __all__ lists. */
const PLUMBING_LINE =
  /^(export\s+(\*|\{[^}]*\}?|type\s+\{[^}]*\}?)(\s+as\s+\w+)?(\s+from\s.*)?;?$|import\s|from\s+\S+\s+import\s|__all__\s*=|[\w.]+,?$|["'][\w.]+["'],?$|[}\])]\s*(from\s.*)?;?$)/;

/**
 * Files with nothing to say: empty package markers and barrels that only
 * re-export other files. They stay in the tree but get no air time.
 */
export function isTrivial(f: RepoFile): boolean {
  const lines = f.content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !COMMENT_LINE.test(l));
  if (lines.length <= 2) return true;
  return lines.length <= 20 && lines.every((l) => PLUMBING_LINE.test(l));
}

export function buildPlan(ingest: IngestResult, length: NarrationLength = "medium"): NarrationPlan {
  const budget = BUDGETS[length];
  const trivialPaths = new Set(
    ingest.files.filter((f) => f.path !== ingest.readmePath && f.category !== "config" && isTrivial(f)).map((f) => f.path),
  );
  let files = ingest.files.filter((f) => f.path !== ingest.readmePath && !trivialPaths.has(f.path));
  // A repo that is only a README still deserves a narration.
  if (files.length === 0) files = ingest.files;

  const hasCode = files.some((f) => !["config", "docs", "data", "test", "style"].includes(f.category));
  const groups = new Map<GroupKind, RepoFile[]>();
  const addToGroup = (kind: GroupKind, f: RepoFile) => groups.set(kind, [...(groups.get(kind) ?? []), f]);
  let individuals: RepoFile[] = [];

  for (const f of files) {
    if (!hasCode) {
      individuals.push(f);
      continue;
    }
    switch (f.category) {
      case "config":
        addToGroup("config", f);
        break;
      case "test":
        addToGroup("tests", f);
        break;
      case "docs":
        addToGroup("docs", f);
        break;
      case "data":
        addToGroup(/(^|\/)(migrations?|seeds?|seeders)\//.test(f.path) ? "migrations" : "data", f);
        break;
      case "style":
        addToGroup("styles", f);
        break;
      case "script":
        addToGroup("scripts", f);
        break;
      case "component":
        if (isUiKit(f.path)) addToGroup("ui-kit", f);
        else individuals.push(f);
        break;
      default:
        individuals.push(f);
    }
  }

  // A tiny UI kit reads better as ordinary components.
  const kit = groups.get("ui-kit");
  if (kit && kit.length <= 3) {
    individuals.push(...kit);
    groups.delete("ui-kit");
  }

  // Too many files for one listen: keep the most central ones individually and
  // fold the rest into "more of …" groups per tier.
  const groupSections = groups.size;
  const maxIndividuals = Math.max(8, budget.maxSections - groupSections);
  const overflow = new Map<FileCategory, RepoFile[]>();
  if (individuals.length > maxIndividuals) {
    const ranked = [...individuals].sort((a, b) => b.importance - a.importance);
    const keep = new Set(ranked.slice(0, maxIndividuals).map((f) => f.path));
    for (const f of individuals) {
      if (!keep.has(f.path)) overflow.set(f.category, [...(overflow.get(f.category) ?? []), f]);
    }
    individuals = individuals.filter((f) => keep.has(f.path));
  }

  // Air time: the most central substantial files get a full section.
  const fullCandidates = individuals
    .filter(
      (f) =>
        f.isEntry ||
        (f.lines >= (f.category === "route" ? 30 : 50) && !["style", "script", "data"].includes(f.category) && !isMostlyMarkup(f)),
    )
    .sort((a, b) => b.importance - a.importance);
  const fullList = fullCandidates.slice(0, budget.maxFull);
  const full = new Set(fullList.map((f) => f.path));
  const major = new Set(fullList.filter((f) => f.lines >= 180).slice(0, budget.maxMajor).map((f) => f.path));
  const depthOf = (f: RepoFile): Depth => (major.has(f.path) ? "major" : full.has(f.path) ? "full" : "brief");

  // Root entry points: the ones nothing else in the repo loads.
  const roots = individuals.filter((f) => f.isEntry && f.importedBy.length === 0);
  // Components a root entry mounts directly (the app shell, the router)
  // describe the app's screens, so they play with the routes.
  const shell = new Set(roots.flatMap((f) => f.imports));
  // Helpers most of the code relies on, like a list of every action name, are
  // foundations: hearing them early means later parts can lean on them.
  const codeCount = files.filter((f) => ["entry", "route", "core", "component", "helper"].includes(f.category)).length;
  const isFoundation = (f: RepoFile) => f.category === "helper" && f.importedBy.length >= Math.max(4, Math.ceil(codeCount * 0.25));
  // A single-page app's HTML shell, which the entry script mounts into.
  const isHostPage = (f: RepoFile) =>
    roots.length > 0 && /(^|\/)index\.html?$/.test(f.path) && /\bid\s*=\s*["'](root|app|__next|main)["']/.test(f.content);
  const tierOf = (f: RepoFile): FileCategory =>
    isHostPage(f) ? "entry" : isFoundation(f) ? "core" : f.category === "component" && shell.has(f.path) ? "route" : f.category;

  // Depth-first walk of the import graph from the entry points and routes, in
  // source order: the order a person would meet each screen and its pieces.
  const byPath = new Map(files.map((f) => [f.path, f]));
  const reach = new Map<string, number>();
  const visit = (path: string) => {
    if (reach.has(path)) return;
    const f = byPath.get(path);
    if (!f) return;
    reach.set(path, reach.size);
    for (const next of f.imports) visit(next);
  };
  [...files]
    .filter((f) => f.isEntry || f.category === "route")
    .sort(
      (a, b) =>
        Number(b.isEntry && b.importedBy.length === 0) - Number(a.isEntry && a.importedBy.length === 0) ||
        Number(b.isEntry) - Number(a.isEntry) ||
        a.path.localeCompare(b.path),
    )
    .forEach((f) => visit(f.path));

  type Keyed = { section: PlanSection; tier: number; order: number };
  const keyed: Keyed[] = [];

  const byTier = new Map<FileCategory, RepoFile[]>();
  for (const f of individuals) byTier.set(tierOf(f), [...(byTier.get(tierOf(f)) ?? []), f]);
  for (const [tier, list] of byTier) {
    const ordered = orderTier(list, tier, reach);
    // Several short files in one folder play better as one section than as a
    // string of tiny parts.
    const briefsByDir = new Map<string, RepoFile[]>();
    for (const f of ordered) {
      if (depthOf(f) === "brief") briefsByDir.set(dirname(f.path), [...(briefsByDir.get(dirname(f.path)) ?? []), f]);
    }
    const folded = new Set<string>();
    ordered.forEach((f, order) => {
      const siblings = briefsByDir.get(dirname(f.path));
      if (depthOf(f) === "brief" && siblings && siblings.length >= 3) {
        if (folded.has(dirname(f.path))) return;
        folded.add(dirname(f.path));
        const dir = dirname(f.path);
        keyed.push({
          tier: TIER[tier],
          order,
          section: {
            id: `group:folder:${tier}:${dir}`,
            kind: "group",
            chapter: chapterOf(TIER[tier]),
            groupKind: "more",
            title: `Smaller pieces in ${dir ? `the ${dir.slice(dir.lastIndexOf("/") + 1)} folder` : "the project root"}`,
            description: `the smaller supporting files that sit together in the ${dir || "root"} folder`,
            paths: siblings.map((s) => s.path),
          },
        });
        return;
      }
      keyed.push({
        tier: TIER[tier],
        order,
        section: {
          id: `file:${f.path}`,
          kind: "file",
          chapter: chapterOf(TIER[tier]),
          path: f.path,
          depth: depthOf(f),
          category: f.category,
          // A brief mention only needs the opening of a long file.
          chunks:
            depthOf(f) !== "brief"
              ? chunkContent(f.content, budget.chunkChars)
              : [{ ...chunkContent(f.content, budget.chunkChars)[0], total: 1 }],
        },
      });
    });
  }

  const omitted: string[] = [];
  const pushGroup = (kind: GroupKind, list: RepoFile[], tier: number, title?: string, idSuffix = "") => {
    const ordered = [...list].sort((a, b) => b.importance - a.importance || a.path.localeCompare(b.path));
    const meta = GROUP_META[kind];
    const section: GroupSection = {
      id: `group:${kind}${idSuffix}`,
      kind: "group",
      chapter: chapterOf(tier),
      groupKind: kind,
      title: title ?? meta.title,
      description: meta.description,
      paths: ordered.slice(0, MAX_GROUP_FILES * 3).map((f) => f.path),
    };
    omitted.push(...ordered.slice(MAX_GROUP_FILES * 3).map((f) => f.path));
    keyed.push({ tier, order: 10_000, section });
  };

  for (const [kind, list] of groups) pushGroup(kind, list, GROUP_META[kind].tier);
  for (const [category, list] of overflow) {
    // A lone leftover file isn't worth a section of its own.
    if (list.length === 1) {
      omitted.push(list[0].path);
      continue;
    }
    // A long "more" list is split by folder so each part stays coherent.
    if (list.length <= MAX_MORE_GROUP) {
      pushGroup("more", list, TIER[category] + 0.5, MORE_TITLES[category] ?? "Everything else", `:${category}`);
      continue;
    }
    const byCluster = new Map<string, RepoFile[]>();
    for (const f of list) byCluster.set(clusterKey(f.path), [...(byCluster.get(clusterKey(f.path)) ?? []), f]);
    const clusters = [...byCluster.entries()].sort((a, b) => b[1].length - a[1].length);
    let rest: RepoFile[] = [];
    clusters.forEach(([key, members], n) => {
      if (members.length >= 4 && n < 4) {
        const folder = key.slice(key.lastIndexOf("/") + 1) || "project root";
        for (let i = 0; i < members.length; i += MAX_MORE_GROUP) {
          pushGroup("more", members.slice(i, i + MAX_MORE_GROUP), TIER[category] + 0.5, `More from the ${folder} folder`, `:${category}:${key}:${i}`);
        }
      } else rest = rest.concat(members);
    });
    if (rest.length) pushGroup("more", rest, TIER[category] + 0.5, MORE_TITLES[category] ?? "Everything else", `:${category}:rest`);
  }

  keyed.sort((a, b) => a.tier - b.tier || a.order - b.order);

  // "More of …" groups only round things out: never let them blow the section budget.
  let sections = keyed.map((k) => k.section);
  const isOverflow = (sec: PlanSection) => sec.kind === "group" && sec.groupKind === "more" && !sec.id.startsWith("group:folder:");
  const excess = sections.length - budget.maxSections;
  if (excess > 0) {
    const drop = new Set(
      sections
        .filter(isOverflow)
        .sort((a, b) => sectionPaths(a).length - sectionPaths(b).length)
        .slice(0, excess)
        .map((sec) => sec.id),
    );
    for (const sec of sections) if (drop.has(sec.id)) omitted.push(...sectionPaths(sec));
    sections = sections.filter((sec) => !drop.has(sec.id));
  }

  // Section IDs key everything downstream; make sure they're unique.
  const seen = new Map<string, number>();
  for (const sec of sections) {
    const n = seen.get(sec.id) ?? 0;
    seen.set(sec.id, n + 1);
    if (n > 0) sec.id = `${sec.id}#${n + 1}`;
  }
  return { sections, omitted: [...omitted, ...trivialPaths], chapterTitles: shapeChapters(sections) };
}

function joinAnd(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * A chapter of one short part sounds like a stray heading, so the last two
 * chapters merge when either is that small. The final chapter is named after
 * what it actually holds: no "tests" in the title of a repo without any.
 */
function shapeChapters(sections: PlanSection[]): Partial<Record<ChapterKey, string>> {
  const titles: Partial<Record<ChapterKey, string>> = {};
  const count = (k: ChapterKey) => sections.filter((s) => s.chapter === k).length;
  const merged = count("support") > 0 && count("setup") > 0 && (count("support") === 1 || count("setup") === 1);
  if (merged) for (const sec of sections) if (sec.chapter === "support") sec.chapter = "setup";
  if (!count("setup")) return titles;

  const kinds = new Set(sections.filter((s) => s.chapter === "setup" && s.kind === "group").map((s) => (s as GroupSection).groupKind));
  const items: string[] = [];
  if (merged) items.push("supporting pieces");
  if (kinds.has("config") || kinds.has("scripts")) items.push("setup");
  if (kinds.has("tests")) items.push("tests");
  if (kinds.has("docs")) items.push("docs");
  const title =
    items.length === 0 ? "Setup and the rest" : items.length === 1 && items[0] === "setup" ? "The project setup" : joinAnd(items);
  const spoken = title.charAt(0).toUpperCase() + title.slice(1);
  if (spoken !== CHAPTER_TITLES.setup) titles.setup = spoken;
  return titles;
}

export function sectionLabel(section: PlanSection): string {
  return section.kind === "file" ? section.path : section.title;
}

export function sectionPaths(section: PlanSection): string[] {
  return section.kind === "file" ? [section.path] : section.paths;
}

export { MAX_GROUP_FILES };
