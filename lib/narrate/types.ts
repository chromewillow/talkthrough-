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
};

export const DEFAULT_OPTIONS: NarrationOptions = { length: "medium", concurrency: 4 };

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
  chapter: ChapterKey;
  path: string;
  depth: Depth;
  category: FileCategory;
  chunks: Chunk[];
};

export type GroupSection = {
  id: string;
  kind: "group";
  chapter: ChapterKey;
  groupKind: GroupKind;
  /** Fallback heading if the model doesn't give one. */
  title: string;
  /** What these files have in common, phrased for the prompt. */
  description: string;
  paths: string[];
};

export type PlanSection = FileSection | GroupSection;

export type NarrationPlan = {
  sections: PlanSection[];
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
  chapter?: ChapterKey;
  /** The model's note on the most useful change here, for the closing guide. */
  changes?: string;
};

export type Walkthrough = {
  repo: RepoInfo;
  model: string;
  createdAt: string;
  title: string;
  overview: string;
  sections: SectionResult[];
  closing: string;
  /** Sections that failed and were left out, so the reader knows. */
  missing: { id: string; label: string }[];
};
