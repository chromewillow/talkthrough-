/**
 * Everything Talkthrough says to the model. Narration quality is the product,
 * so the rules for writing-for-the-ear live in one place and every request
 * shares them.
 */
import type { IngestResult, RepoFile, RepoInfo } from "@/lib/ingest/types";
import { buildTree, type TreeDirNode } from "@/lib/tree";
import { BUDGETS, MAX_GROUP_FILES, sectionLabel, type Budget } from "./plan";
import type { Chunk, FileSection, GroupKind, GroupSection, NarrationLength, NarrationPlan, SectionResult } from "./types";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const SYSTEM_PROMPT = `You are the narrator of Talkthrough. Talkthrough turns a software repository into a spoken walkthrough: your words will be read aloud by a text-to-speech voice, such as ElevenLabs, to someone who builds apps with AI tools. They're smart and curious, but they may not read code fluently. They want to genuinely understand what's in their app, so they can confidently change it, add features, or take features out. They're probably listening on headphones while walking or cooking, and they can't see the code.

How you sound:
- Like a knowledgeable friend sitting beside them, walking through the code together. Warm, calm, unhurried and confident. Speak directly to them as "you", and say "we" when you're exploring together.
- Explain the why, not just the what: why a piece exists, what problem it solves, what would break or change without it.
- Use an everyday comparison only when it genuinely makes something clearer. No hype, no filler, no clichés like "the heart of the app" or "the magic happens", and never talk down to them.

Writing for the ear. This matters more than anything else:
- Write plain prose paragraphs only. No markdown of any kind: no headings, bullet points, numbered lists, bold, italics, tables, links, emoji, or code blocks.
- Never read code aloud. No symbols, brackets, operators, slashes, dots or snippets. Describe what the code does in words instead.
- Say names the way a person says them out loud. Split identifiers into words: handleSubmit becomes "handle submit", useAuthStore becomes "use auth store", MAX_RETRIES becomes "max retries", get_user_by_id becomes "get user by id". Keep it obvious which name you mean, so they can search for it later.
- Refer to files by their name and folder, in words. Say "the page file in the dashboard folder" or "the route file inside the api, chat folder", never "app/dashboard/page.tsx". Only mention a file type when it helps, and say it naturally: "the Python file", "the stylesheet".
- Write out things a voice would stumble over: "for example", not "e.g."; "and", not an ampersand; "versus", not "vs". Common acronyms said as words or letters are fine: API, URL, JSON, HTML, CSS, SQL, AI, UI.
- Keep sentences short to medium, and vary their rhythm. Avoid parentheses; use another sentence instead.
- Don't recite line counts or line numbers. Talk about size in words, like "a short file" or "a few hundred lines". A number that matters, like a thirty-second timeout or a limit of five uploads, is fine.
- Because the listener can't see anything, signpost gently: say what you're about to cover, and connect each idea to the last.

Accuracy:
- Describe only what the code actually shows. If something depends on code you can't see, say so lightly, with "it looks like" or "probably", rather than inventing details.
- Never read out secrets, keys, tokens, passwords or personal data, even if they appear in the code.`;

// ─── Shared context ─────────────────────────────────────────────────────────

export type PromptContext = {
  repo: RepoInfo;
  readme: string | null;
  outline: string;
  stack: string;
  plan: NarrationPlan;
  files: Map<string, RepoFile>;
  budget: Budget;
};

export function buildContext(ingest: IngestResult, plan: NarrationPlan, length: NarrationLength = "medium"): PromptContext {
  const files = new Map(ingest.files.map((f) => [f.path, f]));
  const readmeFile = ingest.readmePath ? files.get(ingest.readmePath) : undefined;
  return {
    repo: ingest.repo,
    readme: readmeFile ? cleanReadme(readmeFile.content) : null,
    outline: outlineTree(buildTree(ingest.files, [], { includeSkipped: false }), 180),
    stack: describeStack(ingest.files),
    plan,
    files,
    budget: BUDGETS[length],
  };
}

/** Strips badges, images and HTML from a README and keeps the opening. */
export function cleanReadme(md: string, max = 2600): string {
  const text = md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\/?(p|div|a|picture|source|br|h\d|span|sup|sub|center|details|summary)[^>]*>/gi, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}\n[README continues]` : text;
}

/** An indented outline of the narrated files, capped for very large repos. */
export function outlineTree(root: TreeDirNode, maxLines: number): string {
  const lines: string[] = [];
  let hidden = 0;
  const walk = (dir: TreeDirNode, depth: number) => {
    for (const node of dir.children) {
      if (lines.length >= maxLines) {
        hidden += node.kind === "dir" ? node.included : 1;
        continue;
      }
      const pad = "  ".repeat(depth);
      if (node.kind === "dir") {
        lines.push(`${pad}${node.name}/`);
        walk(node, depth + 1);
      } else lines.push(`${pad}${node.name}`);
    }
  };
  walk(root, 0);
  if (hidden) lines.push(`(and ${hidden} more files)`);
  return lines.join("\n");
}

/** Languages by share of code, plus the main declared dependencies. */
export function describeStack(files: RepoFile[]): string {
  const bytes = new Map<string, number>();
  let total = 0;
  for (const f of files) {
    if (["config", "docs", "data", "test"].includes(f.category)) continue;
    bytes.set(f.language, (bytes.get(f.language) ?? 0) + f.size);
    total += f.size;
  }
  const langs = [...bytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n / Math.max(1, total) >= 0.03)
    .slice(0, 5)
    .map(([lang, n]) => `${lang} (${Math.round((n / Math.max(1, total)) * 100)}%)`);

  const deps = new Set<string>();
  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf("/") + 1).toLowerCase();
    try {
      if (base === "package.json") {
        const json = JSON.parse(f.content) as { dependencies?: Record<string, string> };
        Object.keys(json.dependencies ?? {}).forEach((d) => deps.add(d));
      } else if (/^requirements[\w.-]*\.txt$/.test(base)) {
        for (const line of f.content.split("\n")) {
          const name = line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1];
          if (name && !line.trim().startsWith("#") && !line.trim().startsWith("-")) deps.add(name);
        }
      } else if (base === "pyproject.toml") {
        const block = f.content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
        for (const m of block.matchAll(/["']([A-Za-z0-9_.-]+)/g)) deps.add(m[1]);
      } else if (base === "go.mod") {
        for (const m of f.content.matchAll(/^\s*([\w.-]+\.[\w.-]+\/[\w./-]+)\s+v[\d.]+(?!.*\/\/ indirect)/gm)) deps.add(m[1]);
      } else if (base === "cargo.toml") {
        const block = f.content.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/)?.[1] ?? "";
        for (const m of block.matchAll(/^\s*([\w-]+)\s*=/gm)) deps.add(m[1]);
      } else if (base === "gemfile") {
        for (const m of f.content.matchAll(/^\s*gem\s+["']([\w-]+)/gm)) deps.add(m[1]);
      }
    } catch {
      // A malformed manifest just means fewer hints.
    }
  }
  const depList = [...deps].slice(0, 40);
  return [
    langs.length ? `Languages: ${langs.join(", ")}.` : "",
    depList.length ? `Main dependencies: ${depList.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function repoName(repo: RepoInfo) {
  return `${repo.owner}/${repo.repo}${repo.subpath ? ` (just the ${repo.subpath} folder)` : ""}`;
}

function contextBlock(ctx: PromptContext, { tree = true } = {}): string {
  const parts = [`Repository: ${repoName(ctx.repo)}`];
  if (ctx.stack) parts.push(ctx.stack);
  if (ctx.readme) parts.push(`From the project's README:\n<readme>\n${ctx.readme}\n</readme>`);
  if (tree) parts.push(`The files we're narrating:\n<tree>\n${ctx.outline}\n</tree>`);
  return parts.join("\n\n");
}

function words([lo, hi]: [number, number]) {
  return `${lo} to ${hi} words`;
}

/**
 * Sections are written in parallel, so each one is nudged toward a different
 * kind of opening; otherwise every part starts "Next up, let's look at…".
 */
const OPENINGS = [
  "Open by saying what this file is for, in one plain sentence, and where it lives.",
  "Open with the question this file answers for the app, then name it and say where it lives.",
  "Open by connecting it to something the listener heard earlier in the tour, then name the file and where it lives.",
  "Open by naming the file and its folder, then say in a few words why the app needs it.",
  "Open with what a user of the app would notice if this file disappeared, then name it and say where it lives.",
];

function tourPosition(ctx: PromptContext, id: string): string {
  const i = ctx.plan.sections.findIndex((s) => s.id === id);
  if (i === -1) return "";
  const total = ctx.plan.sections.length;
  const before = ctx.plan.sections.slice(Math.max(0, i - 6), i).map(sectionLabel);
  const after = ctx.plan.sections.slice(i + 1, i + 3).map(sectionLabel);
  const lines = [`This is part ${i + 1} of ${total} in the tour. The listener has already heard an introduction to the whole app, so don't re-explain what the app is.`];
  if (before.length) lines.push(`Just before this, the tour covered: ${before.join("; ")}.`);
  else lines.push("This is the first part after the introduction.");
  if (after.length) lines.push(`Coming up next: ${after.join("; ")}.`);
  return lines.join("\n");
}

function relations(ctx: PromptContext, file: RepoFile): string {
  const fmt = (paths: string[]) => (paths.length > 12 ? `${paths.slice(0, 12).join(", ")} and ${paths.length - 12} more` : paths.join(", "));
  const lines: string[] = [];
  if (file.importedBy.length) lines.push(`Files that use this one: ${fmt(file.importedBy)}.`);
  else if (file.isEntry) lines.push("Nothing imports this file: it's a starting point that the framework or runtime loads directly.");
  else lines.push("No other narrated file imports this one directly. It's probably loaded by the framework, by convention, or at runtime.");
  if (file.imports.length) lines.push(`Project files it uses: ${fmt(file.imports)}.`);
  return lines.join("\n");
}

const REPLY_FORMAT = `Reply in exactly this format:
TITLE: a short spoken title for this part, three to seven words, such as "The chat API route" or "Where the database is defined"

Then the narration itself, as plain paragraphs.

SUMMARY: one or two plain sentences on what this covers and how it connects to the rest, for whoever writes the introduction.`;

// ─── Per-file ───────────────────────────────────────────────────────────────

export function fileMessages(
  ctx: PromptContext,
  section: FileSection,
  chunk: Chunk,
  earlierParts: string[] = [],
): ChatMessage[] {
  const file = ctx.files.get(section.path);
  if (!file) throw new Error(`Unknown file ${section.path}`);
  const index = ctx.plan.sections.findIndex((s) => s.id === section.id);
  const isFirstChunk = chunk.index === 0;
  const isLastChunk = chunk.index === chunk.total - 1;
  const range = section.depth === "full" ? ctx.budget.fullWords : ctx.budget.briefWords;
  // Long files share the word budget across parts, with a floor so each part says something real.
  const perChunk: [number, number] =
    chunk.total > 1
      ? [Math.max(120, Math.round(range[0] / Math.sqrt(chunk.total))), Math.max(220, Math.round((range[1] * 1.6) / chunk.total))]
      : range;

  const about = [`The file: ${file.path}`, `Language: ${file.language}. Size: about ${roughSize(file.lines)}.`, relations(ctx, file)];
  if (chunk.total === 1 && chunk.endLine < file.lines) {
    about.push(`Only the first ${chunk.endLine} lines are shown below, which is plenty for a short mention.`);
  }
  if (chunk.total > 1) {
    about.push(
      `This file is long, so it's being narrated in ${chunk.total} parts. You're writing part ${chunk.index + 1} of ${chunk.total}, which covers lines ${chunk.startLine} to ${chunk.endLine}.`,
    );
    if (!isFirstChunk && earlierParts.length) {
      about.push(
        `Here's what was already said about the earlier parts of this file:\n<earlier>\n${earlierParts.join("\n\n")}\n</earlier>\nPick up naturally where that left off. Don't re-introduce the file, and don't repeat what was already covered.`,
      );
    }
  }

  const instructions: string[] =
    section.depth === "full"
      ? [
          isFirstChunk ? OPENINGS[index % OPENINGS.length] : "Continue the walkthrough of this file from where the earlier part ended.",
          "Walk through what it does and why it matters, taking its main pieces in a sensible order. Name the important functions, components, settings or data shapes naturally, so the listener could find them later.",
          "Explain how it connects to the rest of the app: what uses it, what it relies on, and what information flows in and out.",
          isLastChunk
            ? "Point out where in this file someone would go to change or add the things a builder is most likely to want, such as text, limits, behaviour or new options. Be specific."
            : "If there's an obvious place in this part to change something a builder would care about, point it out.",
          "Skip trivial details like import lists, boilerplate and type annotations unless they matter to understanding.",
          "Don't start with \"Next up\", \"Now let's look at\" or \"Alright\".",
        ]
      : [
          "This file gets a short mention rather than a full tour. Keep it to one paragraph.",
          isFirstChunk ? "Say what it is and where it lives, why it's there, and when someone would need to touch it." : "Continue briefly from where the earlier part ended.",
          "Don't start with \"Next up\", \"Now let's look at\" or \"Alright\".",
        ];

  const user = [
    contextBlock(ctx),
    tourPosition(ctx, section.id),
    about.join("\n"),
    `<file path="${file.path}">\n${chunk.text}\n</file>`,
    `Write the narration for ${chunk.total > 1 ? "this part of the file" : "this file"}. Aim for about ${words(perChunk)}.\n- ${instructions.join("\n- ")}`,
    REPLY_FORMAT,
  ].join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

function roughSize(lines: number) {
  if (lines < 30) return `${lines} lines, a short file`;
  if (lines < 150) return `${lines} lines`;
  if (lines < 600) return `${lines} lines, a fairly substantial file`;
  return `${lines} lines, a large file`;
}

// ─── Groups ─────────────────────────────────────────────────────────────────

const GROUP_GUIDANCE: Record<GroupKind, string> = {
  config:
    "Say what these settings reveal about how the app is built: the framework and the few libraries that matter most, in plain words, how it's run and deployed, and any code-quality or automation tools. If the app needs environment variables or API keys set up, say what each is for, but never read out a value. Call out the one or two files a builder is most likely to edit.",
  tests:
    "Say what kind of tests these are, what parts of the app they check, and roughly how they're run if that's clear. Mention which tests a builder should keep an eye on when changing a feature.",
  docs: "Summarise what's documented and when it would be worth reading.",
  data:
    "Say what this data or content is, which part of the app reads it, and when someone would edit it instead of changing code.",
  styles:
    "Describe how the look is controlled: colours, fonts, spacing, themes or dark mode, and whether styles are global or per component. Say where someone would go to change the overall look and feel.",
  scripts: "Say what each script is for and when someone would run it.",
  "ui-kit":
    "Explain that these are ready-made building blocks the screens are assembled from, rather than features in their own right. Name the handful that matter most and where they show up. Mention that changing one changes it everywhere it's used, which is the place to adjust shared styling or behaviour.",
  migrations:
    "Explain what these migrations set up or change in the database over time, in plain words. Mention that new migrations are usually generated by a tool after changing the schema, rather than edited by hand.",
  more: "These are the remaining smaller files in this area of the app. Give each one a sentence or two: what it is and what it's for. Keep it brisk.",
};

export function groupMessages(ctx: PromptContext, section: GroupSection): ChatMessage[] {
  const shown = section.paths.slice(0, MAX_GROUP_FILES);
  const listed = section.paths.slice(MAX_GROUP_FILES);
  const share = Math.max(700, Math.floor(ctx.budget.groupChars / Math.max(1, shown.length)));
  const blocks = shown.map((p) => {
    const f = ctx.files.get(p);
    if (!f) return "";
    const body = f.content.length > share ? `${f.content.slice(0, share)}\n[… rest of file not shown]` : f.content;
    return `<file path="${p}">\n${body}\n</file>`;
  });
  if (listed.length) blocks.push(`Also in this group, not shown: ${listed.join(", ")}.`);

  const index = ctx.plan.sections.findIndex((s) => s.id === section.id);
  const user = [
    contextBlock(ctx),
    tourPosition(ctx, section.id),
    `This part covers ${section.paths.length} file${section.paths.length === 1 ? "" : "s"} together, because they're ${section.description}. A working title is "${section.title}".`,
    blocks.join("\n\n"),
    `Write one short section about this group as a whole. Aim for about ${words(ctx.budget.groupWords)}.\n- Don't go through the files one by one in detail. Give the listener the gist, then call out the few that matter most and what they control.\n- ${GROUP_GUIDANCE[section.groupKind]}\n- ${index % 2 === 0 ? "Open by saying plainly what this group of files is for." : "Open by connecting this group to the part of the app it supports."}\n- Don't start with "Next up", "Now let's look at" or "Alright".`,
    REPLY_FORMAT,
  ].join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// ─── Overview and closing ───────────────────────────────────────────────────

function tourListing(results: SectionResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title} (${r.paths.length > 3 ? `${r.paths.slice(0, 3).join(", ")} and ${r.paths.length - 3} more` : r.paths.join(", ")})\n   ${r.summary}`)
    .join("\n");
}

export function overviewMessages(ctx: PromptContext, results: SectionResult[]): ChatMessage[] {
  const user = [
    contextBlock(ctx),
    `The rest of the walkthrough has already been written. Here is the tour, in the order the listener will hear it, with a summary of each part:\n<tour>\n${tourListing(results)}\n</tour>`,
    `Now write the introduction that plays first, before the tour. Aim for about ${words(ctx.budget.overviewWords)}.
- Begin by saying, in a sentence or two, what this app is and what it's for, in plain terms. Don't greet them with "welcome", and don't mention Talkthrough.
- Then sketch the big picture, like a map of the neighbourhood before a walking tour: the main parts of the app and the job each one does.
- Explain how data and actions flow through it. Follow one or two realistic things a person does with the app from start to finish, naming the parts involved along the way.
- Mention the key technologies in plain words, and why they matter here. Skip ones that don't.
- Finish with a sentence or two previewing the order of the tour that follows, so the listener knows what's coming.`,
    "Reply with just the narration, as plain paragraphs. No title line and no summary line.",
  ].join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

export function closingMessages(ctx: PromptContext, results: SectionResult[]): ChatMessage[] {
  const user = [
    contextBlock(ctx, { tree: true }),
    `Here is the walkthrough the listener has just heard, part by part:\n<tour>\n${tourListing(results)}\n</tour>`,
    `Now write the closing part of the walkthrough: a practical guide to where you'd go to change things. Aim for about ${words(ctx.budget.closingWords)}.
- Choose the five to eight changes someone building on this particular app is most likely to want. For example: changing the look, adding a page or screen, changing what the AI says, adding a field to the data, adjusting a limit, or adding a new integration. Pick ones that fit this app.
- For each, say which file or files to open and what to look for once you're there, naming them naturally.
- Mention anything to be careful about, such as things that must change together, or settings that live outside the code like environment variables.
- End with a short, warm sign-off that encourages them to go and explore. Keep it genuine, not cheesy.`,
    "Reply with just the narration, as plain paragraphs. No title line and no summary line.",
  ].join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
