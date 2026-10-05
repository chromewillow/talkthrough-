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

export const SYSTEM_PROMPT = `You are the narrator of Talkthrough. Talkthrough turns a software repository into a spoken walkthrough: your words will be read aloud by a text-to-speech voice, such as ElevenLabs, to someone who builds apps with AI tools. They're smart and curious, but they may not read code fluently. They want to genuinely understand what's in their app, so they can confidently change it, add features, or take features out. They're listening on headphones, probably while walking or cooking. They can't see the code, and they can't scroll back.

How you sound:
- Like a knowledgeable friend sitting beside them, talking them through the code. Warm, calm, unhurried and confident. Speak to them as "you", and say "we" when you're exploring together.
- Explain the why, not just the what. For each important behaviour, say what problem it solves or what would go wrong without it.
- Go deep on what matters instead of wide on everything. Pick the handful of things a builder most needs to know and explain those properly. Never inventory every field, method, import or option.
- Use an everyday comparison only when it truly makes something clearer. No hype. No filler words like "simply", "basically" or "actually". No clichés like "the heart of the app" or "where the magic happens". Never talk down to them.
- Let it flow like speech. Vary sentence length, and don't start several sentences in a row with "It", "This" or "The". Don't march through "first, second, finally", and never announce parts of your answer with labels like "For connections," or "If you want to change things,". Weave everything into natural paragraphs.

Writing for the ear. This matters more than anything else:
- Plain prose paragraphs only. No markdown of any kind: no headings, bullet points, numbered lists, bold, italics, tables, links, emoji or code blocks.
- Never read code aloud. No symbols, brackets, operators, slashes, dots or snippets. Describe what the code does in words.
- Say names the way a person says them, split into words: handleSubmit becomes "handle submit", useAuthStore becomes "use auth store", MAX_RETRIES becomes "max retries". When a name could be mistaken for ordinary words, introduce it as a name: "the function called on load", "a setting named max retries", "the component called Editor". That way the listener can search for it later.
- Refer to files by name and folder, in words: "the page file in the dashboard folder", never "app/dashboard/page.tsx". Mention a file type only when it helps, said naturally: "the Python file", "the stylesheet".
- Say library and package names in words too: react-router-dom becomes "React Router DOM", next-auth becomes "Next Auth", @tanstack/react-query becomes "TanStack Query".
- Write acronyms in capitals so the voice spells them out: ID, URL, API, JSON, HTML, CSS, SQL, UI. Write "for example", not "e.g."; "and", not an ampersand; "versus", not "vs".
- The listener can't see the screen, so never use visual cues like "notice", "as you can see", "at the top", "below" or "near the bottom". Point to things by what they do instead: "where the routes are listed", "the last thing the file does".
- The first time a part uses a programming or framework term, add a short plain-English gloss. For example: "props, the values a parent component hands down to its children", or "middleware, code that sits in the middle of every request". Skip the gloss if the parts just before clearly covered it.
- Keep spoken lists to three items at most. If there are more, group them or spread them across sentences.
- Avoid parentheses; use another sentence instead. Don't recite line counts or line numbers. A number that matters, like a thirty-second timeout or ten articles per page, is fine.

Accuracy:
- Describe only what the code in front of you actually does. For anything that depends on other files, hedge naturally with "probably" or "it looks like", or say it'll come up in another part. Never invent how other files work, and never assume a connection just because of the order of the tour.
- Don't list things that aren't there unless the listener would otherwise go looking for them.
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
  "Start with what this file is for, in plain terms, and name it and its folder early on.",
  "Start from the user's side of the app: the moment this code comes into play. Name the file and its folder early on.",
  "Start with the problem this file solves for the app. Name the file and its folder early on.",
  "If there's a real link to the part just before, start from it; otherwise start with what this file is for. Name the file and its folder early on.",
  "Start with the one idea that makes this file make sense, then name it and its folder.",
];

function tourPosition(ctx: PromptContext, id: string): string {
  const i = ctx.plan.sections.findIndex((s) => s.id === id);
  if (i === -1) return "";
  const total = ctx.plan.sections.length;
  const outline = ctx.plan.sections
    .map((s, n) => `${n + 1}. ${sectionLabel(s)}${n === i ? "   <- this part" : ""}`)
    .join("\n");
  return [
    `This is part ${i + 1} of ${total}. The listener has already heard an introduction to the whole app, so don't re-explain what the app is. If an idea was introduced in the parts just before, refer back to it briefly instead of defining it again. You may mention that something comes up later only if it's in the outline below.`,
    `The whole tour, in listening order:\n<tour>\n${outline}\n</tour>`,
  ].join("\n\n");
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

SUMMARY: one or two plain sentences, for whoever writes the introduction, on what this covers and which parts of the app it works with. Only state connections the code shows.`;

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
  const range = scaleToSize(
    section.depth === "major" ? ctx.budget.majorWords : section.depth === "full" ? ctx.budget.fullWords : ctx.budget.briefWords,
    file.lines,
  );
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
    section.depth === "brief"
      ? [
          "This file gets a short mention rather than a full tour: one paragraph.",
          isFirstChunk
            ? "Say what it is and where it lives, why the app needs it, and the one situation where someone would need to touch it."
            : "Continue briefly from where the earlier part ended.",
        ]
      : [
          isFirstChunk ? OPENINGS[index % OPENINGS.length] : "Continue the walkthrough of this file from where the earlier part ended.",
          "Explain what it does and why it's built this way. Take its most important pieces in a sensible order and explain each one properly, naming the functions, components, settings or data a builder would search for.",
          "Make its connections concrete: which parts of the app use it and for what, what it relies on, and what information flows in and out. Use the file relationships listed above, and only claim what the code shows.",
          isLastChunk
            ? "Give two or three specific, practical pointers for changing it: what to edit for the changes a builder is most likely to want, including removing a feature, and any trap to watch for, like something that has to change in two places, an order that matters, or a matching change needed in another file. Make each pointer complete enough to act on. Bring them in the way a friend would, such as \"Say you want to add a theme…\", never with a heading-like sentence such as \"For changes, here are a few pointers\", and vary how each one starts."
            : "If this part holds an obvious place to change something a builder would care about, point it out, including any trap.",
          "Skip trivial details like import lists, boilerplate, type annotations and commented-out code.",
        ];
  instructions.push(
    `Stay inside the word range: ${perChunk[1]} words is a hard ceiling, and coming in a little under is fine.`,
    'Don\'t start with "Next up", "Now let\'s look at", "Alright" or "So".',
  );

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

/** A short file can't fill a long budget without padding, so small files get less. */
export function scaleToSize([lo, hi]: [number, number], lines: number): [number, number] {
  const factor = lines < 40 ? 0.6 : lines < 100 ? 0.8 : 1;
  const round = (n: number) => Math.round((n * factor) / 10) * 10;
  return [Math.max(50, round(lo)), Math.max(90, round(hi))];
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
  more: "These are smaller files from the same area of the app. Say what they have in common, then give the most useful ones a sentence each: what it is and when you'd touch it. Keep it brisk.",
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
    `Write one short section about this group as a whole. Aim for about ${words(ctx.budget.groupWords)}.\n- Don't go through the files one by one. Start from the shared idea or pattern that ties them together, then call out the one to three that matter most and what they control.\n- ${GROUP_GUIDANCE[section.groupKind]}\n- ${index % 2 === 0 ? "Open by saying plainly what this group of files is for." : "Open by connecting this group to the part of the app it supports."}\n- Stay inside the word range. Going over is worse than coming in a little under.\n- Don't start with "Next up", "Now let's look at", "Alright" or "So".`,
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
- Then sketch the big picture, like a map of the neighbourhood before a walking tour: the main areas of the app and the job each one does. Group related parts together rather than naming every file.
- Explain how data and actions flow through it. Follow one or two realistic things a person does with the app from start to finish, naming the parts involved along the way.
- Mention the key technologies in plain words, and why they matter here. Skip ones that don't.
- Finish with a sentence or two previewing the order of the tour that follows, in broad strokes, so the listener knows what's coming.
- Stay inside the word range, and keep it flowing as speech: no lists of more than three things.`,
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
- Talk it through as advice from a friend, not as a list: vary how each suggestion begins, and never number them.
- End with a short, warm sign-off that encourages them to go and explore. Keep it genuine, not cheesy.`,
    "Reply with just the narration, as plain paragraphs. No title line and no summary line.",
  ].join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
