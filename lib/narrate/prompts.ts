/**
 * Everything Talkthrough says to the model. Narration quality is the product,
 * so the rules for writing-for-the-ear live in one place and every request
 * shares them.
 */
import type { IngestResult, RepoFile, RepoInfo } from "@/lib/ingest/types";
import { buildTree, type TreeDirNode } from "@/lib/tree";
import { BUDGETS, MAX_GROUP_FILES, sectionLabel, type Budget } from "./plan";
import { CHAPTER_TITLES, type ChapterKey, type Chunk, type FileSection, type GroupKind, type GroupSection, type NarrationLength, type NarrationPlan, type SectionResult } from "./types";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const SYSTEM_PROMPT = `You are the narrator of Talkthrough. Talkthrough turns a software repository into a spoken walkthrough: your words will be read aloud by a text-to-speech voice, such as ElevenLabs, to someone who builds apps with AI tools. They're smart and curious, but they may not read code fluently. They want to genuinely understand what's in their app, so they can confidently change it, add features, or take features out. They're listening on headphones, probably while walking or cooking. They can't see the code, and they can't scroll back.

How you sound:
- Like a knowledgeable friend sitting beside them, talking them through the code. Warm, calm, unhurried and confident. Speak to them as "you", and say "we" when you're exploring together.
- Explain the why, not just the what. Every check, limit, default, fallback, ordering, reset or optional feature you mention needs half a sentence on what the user would see, or what would break, without it. If the code doesn't show the reason, give the likely one with "probably". If you can't give any reason, leave the item out rather than list it.
- Be the friend who warns them. If you spot a likely bug, a surprising default, a setting that behaves differently from its name, something that only works in one environment, or a pattern newer library versions have deprecated, give it a sentence or two: what the user would notice, and where the fix would go. If there are several, pick the one with the most visible effect.
- Go deep on what matters instead of wide on everything. Pick the handful of things a builder most needs to know and explain those properly.
- Tell it as a story, not an inventory. Never read out more than three names in a row; group the rest by purpose and name only what a builder would touch. Don't write three or more sentences with the same shape, like "The X file does Y. The Z file does W." Link ideas by cause instead: "because", "so", "which means", "the catch is". Vary sentence length.
- Never talk about the tour's machinery: no "this group", "these sixteen files" or "this part", and don't restate metadata you were given, like "nothing imports this file". Never announce parts of your answer with labels like "For connections," or "If you want to change things,", and don't march through "first, second, finally".
- No hype. No filler like "simply", "basically", "actually", "notably" or "notice". No clichés like "the heart of the app" or "where the magic happens". Never talk down to them.

Names:
- Say names the way a person says them, split into words: handleSubmit is "handle submit", MAX_RETRIES is "max retries". Keep the code's exact words; never swap in a friendlier synonym. If the function is called del, say "del", not "delete". You can add a plain description after the real name, never instead of it.
- The listener can't hear capital letters, so frame each name the first time: "a function called submit form", "the Comment component", "a setting named max retries", "a library called Marked". Never open a sentence with a bare name. Names like on load, list errors or process file otherwise sound like broken English.
- Whenever you single something out, give its searchable name, not just its role. Do the same for environment variables, action names, storage keys, web addresses and settings: "the variable called auth secret", "the address slash health". Never say a secret's value.
- Use one name per thing for the whole part. For web handlers named after HTTP methods, say what triggers them: "the POST handler, which runs when the browser sends a new message".

Writing for the ear. This matters more than anything else:
- Plain prose paragraphs only. No markdown of any kind: no headings, bullet points, numbered lists, bold, italics, tables, links, emoji or code blocks.
- Never read code aloud. No symbols, brackets, operators, slashes, dots or snippets. Describe what the code does in words.
- Refer to files by name and folder, in words, never as a path. Say nested folders with "inside", innermost first: "the route file in the chat folder, inside api". Never join folder names with commas, because that sounds like a list. Mention a file type only when it helps: "the Python file", "the stylesheet".
- Write things the way the voice should say them. Acronyms go in capitals even when a folder is lowercase: "the UI folder", "ID", "IDs", "API". Product names go without dots: "Next JS", "Node JS", "the package JSON file". Library names go in words: react-router-dom is "React Router DOM". Spell names a voice would mangle the way they're said: "shad C N". Write abbreviations out: "utilities", "git ignore", "text area". Say numbers the way developers do: "port eighty eighty", "version three point eleven".
- Don't put quotation marks or trailing dots around on-screen text. Say "a message that reads Still waiting".
- The listener can't see the screen, so never use visual cues like "as you can see", "at the top", "below" or "near the bottom". Point to things by what they do: "where the routes are listed", "the last thing the file does".
- The first time a part uses a programming, framework or web term, gloss it in a few plain words in the same sentence: "a reducer, the function that decides how the shared data changes", "a slug, the short web-address version of a title". If an earlier part explained it, a three-word reminder is enough. Never defer it with "we'll get to that later". If a term isn't worth glossing, describe the behaviour instead of naming it.
- Avoid parentheses; use another sentence instead. Don't recite line counts or line numbers.

Accuracy:
- Check before you claim. Before you state a count, count the items in the code; if you're going to name them anyway, drop the number. Before you say "every", "all", "only", "each" or "never", make sure the code shows it.
- Trace a value from where it's set to where it's used before you say what it does. If it starts empty, is never used, or gets overridden, say that instead.
- Describe things in the order they run, not the order they appear in the file. Say exactly how a check behaves: a hard stop or a skip, a real network call or a stand-in, and what the user sees when it triggers.
- When an effect depends on framework or browser behaviour you can't confirm, say what the code is meant to do. A reason the code and its comments don't state, or a purpose guessed from a name, gets "probably".
- Files that use this one, or that it uses, are not shown to you. Say what they do only as far as this file proves it. Never assume a connection just because of the order of the tour.
- Hedge sparingly: "probably" or "likely" at most twice in a part, since a long listen full of them sounds unsure. If a guess about another file doesn't change the point, leave it out. If it does, give the listener something to do instead, like "check the pagination component too".
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
  /** Terms the introduction defines once, so parts don't keep redefining them. */
  terms: string[];
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
    terms: coreTerms(collectDeps(ingest.files), ingest.files),
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

/** Package names declared in the repo's manifests. */
export function collectDeps(files: RepoFile[]): Set<string> {
  const deps = new Set<string>();
  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf("/") + 1).toLowerCase();
    try {
      if (base === "package.json") {
        const json = JSON.parse(f.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        Object.keys(json.dependencies ?? {}).forEach((d) => deps.add(d));
      } else if (/^requirements[\w.-]*\.txt$/.test(base)) {
        for (const line of f.content.split("\n")) {
          const name = line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1];
          if (name && !line.trim().startsWith("#") && !line.trim().startsWith("-")) deps.add(name.toLowerCase());
        }
      } else if (base === "pyproject.toml") {
        const block = f.content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
        for (const m of block.matchAll(/["']([A-Za-z0-9_.-]+)/g)) deps.add(m[1].toLowerCase());
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
  return deps;
}

const TERM_SETS: { when: (deps: string[]) => boolean; terms: string[] }[] = [
  { when: (d) => d.some((x) => /^(react|react-dom|next|preact|react-native|expo)$/.test(x)), terms: ["component", "props", "state", "hook"] },
  { when: (d) => d.includes("next"), terms: ["route", "server component"] },
  { when: (d) => d.some((x) => /^(redux|@reduxjs\/toolkit|react-redux)$/.test(x)), terms: ["store", "action", "reducer", "middleware"] },
  { when: (d) => d.some((x) => /^(zustand|jotai|mobx|pinia|vuex)$/.test(x)), terms: ["store"] },
  { when: (d) => d.some((x) => /^(express|fastify|koa|hono|@nestjs\/core)$/.test(x)), terms: ["route", "middleware", "request handler"] },
  { when: (d) => d.some((x) => /^(vue|nuxt|svelte|@sveltejs\/kit)$/.test(x)), terms: ["component", "props", "reactive state"] },
  { when: (d) => d.some((x) => /prisma|drizzle|sequelize|typeorm|mongoose|sqlalchemy|^django$|supabase|firebase/.test(x)), terms: ["schema", "query"] },
  { when: (d) => d.some((x) => /^(fastapi|flask|django)$/.test(x)), terms: ["endpoint", "request", "response"] },
  { when: (d) => d.some((x) => /^(ai|openai|@anthropic-ai\/sdk|langchain|@ai-sdk\/.+|llamaindex)$/.test(x)), terms: ["prompt", "model", "streaming"] },
];

const SCRIPT_FILE = /\.(m?jsx?|tsx?|vue|svelte)$/;

// Terms a dependency makes possible but only the code proves: an app on old
// class components has React but no hooks, and not every Next app has an app folder.
const TERM_EVIDENCE: Record<string, (files: RepoFile[]) => boolean> = {
  hook: (files) => files.some((f) => SCRIPT_FILE.test(f.path) && /\buse[A-Z]\w*\s*\(/.test(f.content)),
  "server component": (files) => files.some((f) => /(^|\/)app\/(.+\/)?(page|layout)\.(jsx?|tsx?)$/.test(f.path)),
};

/** Programming terms this stack leans on, defined once in the introduction. */
export function coreTerms(deps: Set<string>, files?: RepoFile[]): string[] {
  const list = [...deps];
  const terms: string[] = [];
  for (const set of TERM_SETS) {
    if (!set.when(list)) continue;
    for (const t of set.terms) {
      if (terms.includes(t)) continue;
      if (files && TERM_EVIDENCE[t] && !TERM_EVIDENCE[t](files)) continue;
      terms.push(t);
    }
  }
  return terms.slice(0, 10);
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

  const deps = collectDeps(files);
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

/** A single target reads better than a range, which models treat as "aim for the top". */
function target([lo, hi]: [number, number]) {
  return `Aim for about ${Math.round((lo + hi) / 20) * 10} words, and never go over ${hi}. If you're over, cut lists of names first, then restated structure, then framing sentences. Never cut the why or the change pointers.`;
}

/**
 * Sections are written in parallel, so each is nudged toward an opening that
 * suits its role; otherwise every part starts the same way.
 */
const OPENING_ANGLES: Record<string, string[]> = {
  entry: [
    "Open with where this file sits in the app's start-up: what has to happen before anything else works.",
    "Open with what would be missing if the app started without it.",
  ],
  route: [
    "Open from the user's side: the moment in the app when this page or endpoint comes into play.",
    "Open with the visit or request that this code answers.",
  ],
  core: ["Open with the problem this file solves for the rest of the app.", "Open with the one idea that makes this file make sense."],
  component: ["Open with what the person using the app sees or does here.", "Open with where this piece shows up on screen and what it's for."],
  helper: ["Open with what this file saves the rest of the code from doing.", "Open with the small job it does and who relies on it."],
  other: ["Open with what this file is for, in plain terms.", "Open with why the app needs it."],
};

/** Sentence shapes for the first line, rotated so neighbouring parts don't start alike. */
const OPENING_SHAPES = [
  "Make that idea your first sentence, and bring in the file's name and its folder in the second.",
  "Start from a concrete moment when this code runs, such as a click, a page loading or a request arriving, and name the file and its folder by the second sentence.",
  'You may lead with the file\'s name and folder, but don\'t use the shape "The X file, in the Y folder, is…", which many other parts use.',
];

const BANNED_OPENINGS =
  'Don\'t open with "This file", "This is", "Here we have", "Next up", "Now let\'s", "Alright", "So", "Remember", "Imagine", "If this file disappeared", "Everything we\'ve covered so far", or a question followed by "That\'s the question this file answers".';

const FLOW_RULES = [
  "Tie this part back to at least one earlier part by name, with the concrete hand-off: what is passed, by whom, to whom. For example: \"the index file we heard about earlier hands this store to the whole app.\"",
  "Say \"we just heard\" only about the part immediately before. For older parts say \"earlier\". Never say the listener has heard about something that isn't listed as covered, never say \"we're about to\", and never make sweeping claims like \"everything so far\".",
  "End with the most useful takeaway, in its own short paragraph. Don't end on a leftover fact, and don't announce the next part by name; the tour announces each part.",
];

function tourPosition(ctx: PromptContext, id: string): string {
  const i = ctx.plan.sections.findIndex((s) => s.id === id);
  if (i === -1) return "";
  const total = ctx.plan.sections.length;
  const outline = ctx.plan.sections
    .map((s, n) => `${n + 1}. ${sectionLabel(s)}${n === i ? "   <- this part" : ""}`)
    .join("\n");
  const lines = [
    `This is part ${i + 1} of ${total}. The listener has already heard an introduction to the whole app, so don't re-explain what the app is. If an idea was introduced in an earlier part, refer back to it briefly instead of defining it again. You may mention that something comes up later only if it's in the outline below.`,
  ];
  if (ctx.terms.length) {
    lines.push(
      `The introduction defines these terms for the listener: ${ctx.terms.join(", ")}. Don't define them again; a few words of reminder at most.`,
    );
  }
  const recency: string[] = [];
  if (i > 0) recency.push(`Immediately before this part: ${sectionLabel(ctx.plan.sections[i - 1])}.`);
  if (i > 1) {
    const earlier = ctx.plan.sections.slice(Math.max(0, i - 8), i - 1).reverse().map(sectionLabel);
    recency.push(`Earlier in the tour, most recent first: ${earlier.join("; ")}${i - 1 > 7 ? "; and more" : ""}.`);
  }
  if (i === 0) recency.push("This is the first part after the introduction.");
  if (i < total - 1) recency.push(`Coming up next: ${ctx.plan.sections.slice(i + 1, i + 3).map(sectionLabel).join("; then ")}.`);
  recency.push("Anything not listed in the tour outline before this part hasn't been covered yet.");
  if (i === total - 1) {
    recency.push(
      "This is the last part of the tour before the closing guide. End with two or three sentences that pull it together: how the main pieces fit, and where a builder would most likely start changing things.",
    );
  }
  lines.push(recency.join("\n"));
  lines.push(`The whole tour, in listening order:\n<tour>\n${outline}\n</tour>`);
  return lines.join("\n\n");
}

function relations(ctx: PromptContext, file: RepoFile): string {
  const fmt = (paths: string[]) => (paths.length > 12 ? `${paths.slice(0, 12).join(", ")} and ${paths.length - 12} more` : paths.join(", "));
  const lines: string[] = [];
  const isGo = file.path.endsWith(".go");
  if (file.importedBy.length) lines.push(`${isGo ? "Files that import this file's package" : "Files that use this one"}: ${fmt(file.importedBy)}.`);
  else if (file.isEntry) lines.push("Nothing imports this file: it's a starting point that the framework or runtime loads directly.");
  else lines.push("No other narrated file imports this one directly. It's probably loaded by the framework, by convention, or at runtime.");
  if (file.imports.length) lines.push(`Project files it uses: ${fmt(file.imports)}.`);
  return lines.join("\n");
}

const REPLY_FORMAT = `Reply in exactly this format:
TITLE: a short, specific spoken title in sentence case, three to seven words, such as "The chat API route" or "Where the database is defined". For a group, write your own title from what the files do rather than reusing the working title.

Then the narration itself, as plain paragraphs.

CHANGES: one or two plain sentences for the guide to changes at the end of the tour: the single most useful change a builder might make here and exactly where, plus any trap, bug or rough edge you noticed. Write "none" if nothing stands out.

SUMMARY: one or two plain sentences, for whoever writes the introduction, on what this part covers and which files use it or are used by it. Describe how the code connects, not the order of the tour, and include only what the narration actually says, with the same counts.`;

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

  const role = section.category === "entry" || section.category === "route" || section.category === "core" || section.category === "component" || section.category === "helper" ? section.category : "other";
  const angles = OPENING_ANGLES[role];
  const instructions: string[] =
    section.depth === "brief"
      ? [
          "This file gets a short mention rather than a full tour: one paragraph.",
          isFirstChunk
            ? "Say what it is and where it lives, and why the app needs it. Give one concrete situation where someone would edit it, the name to search for, and any trap you can see, like a list written out twice. Avoid \"only\" unless the file truly has one job."
            : "Continue briefly from where the earlier part ended.",
        ]
      : [
          isFirstChunk
            ? `${angles[index % angles.length]} ${OPENING_SHAPES[index % OPENING_SHAPES.length]}`
            : "Continue the walkthrough of this file from where the earlier part ended.",
          "Explain what it does and why it's built this way. Take its most important pieces in a sensible order and explain each one properly, naming the functions, components, settings or data a builder would search for.",
          "Make its connections concrete: which parts of the app use it and for what, what it relies on, and what information flows in and out. Use the file relationships listed above, and only claim what the code shows.",
          isLastChunk
            ? "Give one to three change pointers a builder could act on without guessing, depending on how much this file controls. Each names the change they'd want, the exact function, setting or value to search for, and every other place that has to change with it: a second copy of the same list, a matching ID in another file, a flag that controls whether it shows, a backend that must accept a new field, a step that registers the new thing. If one of those places is in another file, name it and say what to check there. A partial recipe is worse than none. Consider removing a feature, not only adding one. Bring each one in the way a friend would, starting from the goal, like \"To show twenty articles a page…\" or \"If you'd rather sign people in with a magic link…\", never with a heading-like sentence. Stock lead-ins such as \"Say you want\" and \"The catch is\" wear thin over a long tour, so don't use them."
            : "If this part holds an obvious place to change something a builder would care about, point it out, including any trap.",
          "Only say \"this is where you change X\" if X is actually written in this file. If this file just uses something defined elsewhere, such as prompt text, a model list, theme colours or error wording, send them to that file instead. Name the hard-coded values a builder is likely to hit, such as timeouts, page sizes, ports and delays, with the value in words.",
          "Skip trivial details like import lists, boilerplate, type annotations and commented-out code.",
        ];
  if (isFirstChunk) instructions.push(BANNED_OPENINGS);
  instructions.push(...FLOW_RULES, target(perChunk));

  const user = [
    contextBlock(ctx),
    tourPosition(ctx, section.id),
    about.join("\n"),
    `<file path="${file.path}">\n${chunk.text}\n</file>`,
    `Write the narration for ${chunk.total > 1 ? "this part of the file" : "this file"}.\n- ${instructions.join("\n- ")}`,
    REPLY_FORMAT,
  ].join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** A short file can't fill a long budget without padding, so small files get less. */
export function scaleToSize([lo, hi]: [number, number], lines: number): [number, number] {
  const factor = lines < 40 ? 0.65 : lines < 100 ? 0.85 : 1;
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
    "Say what these settings reveal about how the app is built and run: the framework and the few libraries that matter most, in plain words, and how it's deployed. Account for every script and dev dependency before summing up, and mention a missing tool only if its absence changes what the listener should do. Point out any file that instructs AI coding assistants, such as Cursor rules or a CLAUDE file, and what it tells them. For each environment variable, say its name in words, which feature uses it, and whether it's optional; never its value.",
  tests:
    "Say what kind of tests these are, what parts of the app they check, and roughly how they're run if that's clear. Mention which tests a builder should keep an eye on when changing a feature.",
  docs: "Summarise what's documented and when it would be worth reading.",
  data:
    "Say what this data or content is, which part of the app reads it, and when someone would edit it instead of changing code.",
  styles:
    "Describe how the look is controlled: colours, fonts, spacing, themes or dark mode, and whether styles are global or per component. Say where someone would go to change the overall look and feel.",
  scripts: "Say what each script is for and when someone would run it.",
  "ui-kit":
    "Explain that these are ready-made building blocks the screens are assembled from, rather than features in their own right. A change in one of these files shows up everywhere it's used, but check first: if a style points at a theme colour, the real value probably lives in the global stylesheet, and settings like corner rounding may be repeated in each file. A single use can usually be restyled where it's used, without touching the shared file.",
  migrations:
    "Explain what these migrations set up or change in the database over time, in plain words. Mention that new migrations are usually generated by a tool after changing the schema, rather than edited by hand.",
  more: "These are smaller files from the same area of the app. Keep it brisk.",
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

  const user = [
    contextBlock(ctx),
    tourPosition(ctx, section.id),
    `This part covers ${section.paths.length} file${section.paths.length === 1 ? "" : "s"} together, because they're ${section.description}. A working title is "${section.title}".`,
    blocks.join("\n\n"),
    `Write one short section about these files as a whole.\n- Open with the one idea that ties them together, said as something that happens in the app, in a sentence the listener can hold onto. For example: "each page fills its own slot when you arrive and empties it when you leave."\n- Then name at most three files, the ones that control behaviour. For each, say where it shows up for the user and one concrete thing you'd change there, with the name to search for. Cover the rest in one sentence by what they do together. Never give every file its own sentence.\n- If a piece is a generic building block and the app has its own file built on it, say which one to open for which kind of change.\n- ${GROUP_GUIDANCE[section.groupKind]}\n- Don't open with "This group", "These files", "Everything we've covered so far" or a count of files.\n- ${FLOW_RULES.slice(1).join("\n- ")}\n- ${target(ctx.budget.groupWords)}`,
    REPLY_FORMAT,
  ].join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// ─── Overview and closing ───────────────────────────────────────────────────

function tourListing(results: SectionResult[], { changes = false } = {}): string {
  return results
    .map((r, i) => {
      const paths = r.paths.length > 3 ? `${r.paths.slice(0, 3).join(", ")} and ${r.paths.length - 3} more` : r.paths.join(", ");
      const note = changes && r.changes && !/^none\.?$/i.test(r.changes.trim()) ? `\n   Change notes: ${r.changes}` : "";
      return `${i + 1}. ${r.title} (${paths})\n   ${r.summary}${note}`;
    })
    .join("\n");
}

/** The chapters in listening order, with how many parts each holds. */
function chapterListing(results: SectionResult[]): string {
  const counts: { key: ChapterKey; n: number }[] = [];
  for (const r of results) {
    if (!r.chapter) continue;
    const last = counts[counts.length - 1];
    if (last && last.key === r.chapter) last.n++;
    else counts.push({ key: r.chapter, n: 1 });
  }
  return counts.map((c) => `${CHAPTER_TITLES[c.key]} (${c.n} part${c.n === 1 ? "" : "s"})`).join("; ");
}

/** Rough listening time for the whole script, at about 150 words a minute. */
function estimateMinutes(ctx: PromptContext, results: SectionResult[]): number {
  const bodyWords = results.reduce((n, r) => n + r.body.split(/\s+/).length, 0);
  const extra = (ctx.budget.overviewWords[1] + ctx.budget.closingWords[1]) * 0.85;
  return Math.max(5, Math.round((bodyWords + extra) / 150 / 5) * 5);
}

export function overviewMessages(ctx: PromptContext, results: SectionResult[]): ChatMessage[] {
  const chapters = chapterListing(results);
  const user = [
    contextBlock(ctx),
    `The rest of the walkthrough has already been written. Here is the tour, in the order the listener will hear it, with a summary of each part:\n<tour>\n${tourListing(results)}\n</tour>`,
    `Now write the introduction that plays first, before the tour.
- Begin by saying, in a sentence or two, what this app is and what it's for, in plain terms. If it has a product name, use it. Don't greet them with "welcome", and don't mention Talkthrough.
- Then give the big picture: the main areas of the app and the job each one does. Group related parts together rather than naming every file, and use the same names for things that the parts use.
- Explain how data and actions flow through it. Follow one or two realistic things a person does with the app from start to finish, naming the parts involved along the way.
- Mention the key technologies in plain words, and why they matter here. Skip ones that don't.${
      ctx.terms.length
        ? `\n- The parts that follow rely on you to define these terms, so explain each one briefly, once, where it first comes up naturally: ${ctx.terms.join(", ")}.`
        : ""
    }
- Finish by previewing the tour: ${chapters ? `it's organised into these chapters, in order: ${chapters}. ` : ""}It runs about ${estimateMinutes(ctx, results)} minutes. Keep the preview to two or three sentences.
- Keep it flowing as speech: no lists of more than three things, and no stock phrases.
- ${target(ctx.budget.overviewWords)}`,
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
    `Here is the walkthrough the listener has just heard, part by part, with the change notes each part made:\n<tour>\n${tourListing(results, { changes: true })}\n</tour>`,
    `Now write the closing part of the walkthrough: a practical guide to where you'd go to change things.
- Choose the five to seven changes someone building on this particular app is most likely to want, such as changing the look, adding a page or screen, changing what the AI says, adding a field to the data, adjusting a limit, or adding an integration. Pick ones that fit this app, and include how to remove or switch off a feature if that fits.
- For each, say which file or files to open and what to look for once you're there, naming them the way the parts did.
- Base every suggestion on what the parts actually said, especially their change notes. Don't contradict them, and don't hedge where a part was specific.
- Mention anything to be careful about, such as things that must change together, or settings that live outside the code like environment variables.
- If the parts noticed bugs or rough edges, gather the most important ones into one short paragraph of things worth fixing first.
- Talk it through as advice from a friend, not as a list: vary how each suggestion begins, and never number them.
- End with a short, warm sign-off that suggests one concrete first change to try. Keep it genuine, not cheesy.
- ${target(ctx.budget.closingWords)}`,
    "Reply with just the narration, as plain paragraphs. No title line and no summary line.",
  ].join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
