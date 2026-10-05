import type { FileCategory, RepoInfo } from "@/lib/ingest/types";

/** Where the model lives. The key never leaves the browser except to reach this endpoint. */
export type LlmSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * How long the walkthrough should be. Only "medium" is offered today; the
 * budgets for the others already exist so a length picker is a UI-only change.
 */
export type NarrationLength = "short" | "medium" | "long";

export type NarrationOptions = {
  length: NarrationLength;
  /** Requests in flight at once. */
  concurrency: number;
  /**
   * Give each part a second look once the parts before it exist, to cut
   * repeats and check facts. Better narration for about twice the requests.
   */
  revise?: boolean;
};

export const DEFAULT_OPTIONS: NarrationOptions = { length: "medium", concurrency: 4, revise: true };

/** How much air time a file gets: the few biggest, most central files get the most. */
export type Depth = "major" | "full" | "brief";

export type GroupKind =
  | "config"
  | "tests"
  | "docs"
  | "data"
  | "styles"
  | "scripts"
  | "ui-kit"
  | "migrations"
  | "more";

/** The spoken chapters the tour is grouped into. */
export type ChapterKey = "start" | "core" | "interface" | "support" | "setup";
/** A chapter's id: a ChapterKey, or "interface:2" and so on when a long chapter is split. */
export type ChapterId = ChapterKey | `${ChapterKey}:${number}`;

export const CHAPTER_TITLES: Record<ChapterKey, string> = {
  start: "Where it all starts",
  core: "The core logic",
  interface: "What you see on screen",
  support: "Helpers and supporting pieces",
  setup: "Setup, tests and docs",
};

export type Chunk = {
  index: number;
  total: number;
  startLine: number;
  endLine: number;
  text: string;
};

export type FileSection = {
  id: string;
  kind: "file";
  chapter: ChapterId;
  path: string;
  depth: Depth;
  category: FileCategory;
  chunks: Chunk[];
};

export type GroupSection = {
  id: string;
  kind: "group";
  chapter: ChapterId;
  groupKind: GroupKind;
  /** Fallback heading if the model doesn't give one. */
  title: string;
  /** What these files have in common, phrased for the prompt. */
  description: string;
  paths: string[];
};

export type PlanSection = FileSection | GroupSection;

/** A chapter's spoken title: the plan's, or the default for its key. */
export function chapterTitle(id: ChapterId, titles?: Partial<Record<string, string>>): string {
  return titles?.[id] ?? CHAPTER_TITLES[id.split(":")[0] as ChapterKey] ?? "More of the app";
}

export type NarrationPlan = {
  sections: PlanSection[];
  /** Chapter titles that differ from the defaults, such as a setup chapter with no tests in it. */
  chapterTitles?: Partial<Record<string, string>>;
  /** Files we kept but didn't narrate (they still appear in the overview's map). */
  omitted: string[];
};

export type SectionResult = {
  id: string;
  title: string;
  body: string;
  summary: string;
  paths: string[];
  /** Which chapter of the tour this part belongs to. */
  chapter?: ChapterId;
  /** The chapter's spoken title, when it isn't the default for its key. */
  chapterTitle?: string;
  /** A sentence or two that leads into this part's chapter, when it opens one. */
  bridge?: string;
  /** Terms this part explained, so later parts don't explain them again. */
  terms?: string[];
  /** Mechanisms and warnings this part explained in full. */
  explained?: string[];
  /** Bugs and rough edges whose code is in this part's files. */
  bugs?: string[];
  /** Values and locations other parts might also mention. */
  facts?: string[];
  /** Complete change recipes, for the closing guide to merge. */
  recipes?: string[];
  /** The model's note on the most useful change here, for the closing guide. */
  changes?: string;
};

export type Walkthrough = {
  repo: RepoInfo;
  /** The app's name as said aloud, such as "Conduit", when the introduction gave one. */
  name?: string;
  model: string;
  createdAt: string;
  title: string;
  overview: string;
  sections: SectionResult[];
  closing: string;
  /** Sections that failed and were left out, so the reader knows. */
  missing: { id: string; label: string }[];
};
