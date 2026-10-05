/**
 * Everything Talkthrough says to the model. Narration quality is the product,
 * so the rules for writing-for-the-ear live in one place and every request
 * shares them.
 */
import type { IngestResult, RepoFile, RepoInfo } from "@/lib/ingest/types";
import { buildTree, type TreeDirNode } from "@/lib/tree";
import { buildLinkIndex, relatedExcerpts, type LinkIndex, type RelatedExcerpt } from "./links";
import { BUDGETS, MAX_GROUP_FILES, sectionLabel, type Budget } from "./plan";
import { chapterTitle, type Chunk, type FileSection, type GroupKind, type GroupSection, type NarrationLength, type NarrationPlan, type PlanSection, type SectionResult } from "./types";

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
- The listener can't hear capital letters, so frame every name, every time, with what kind of thing it is: "the submit form function", "the Comment component", "the max retries setting", "a library called Marked". Never open a sentence with a bare name or put a verb straight after one; names like component will mount, on load or is user otherwise sound like broken English.
- Never describe code structure, like arguments, "this dot props", spreading or "the map"; say what it does.
- Whenever you single something out, give its searchable name, not just its role. Do the same for environment variables, action names, storage keys, web addresses and settings: "the variable called auth secret", "the address slash health". Never say a secret's value.
- Use one name per thing for the whole part, and for other files use the spoken name the tour outline gives. For web handlers named after HTTP methods, say what triggers them: "the POST handler, which runs when the browser sends a new message".

Writing for the ear. This matters more than anything else:
- Plain prose paragraphs only. No markdown of any kind: no headings, bullet points, numbered lists, bold, italics, tables, links, emoji or code blocks.
- Never read code aloud. No symbols, brackets, operators, slashes, dots or snippets. Describe what the code does in words.
- Refer to files by name and folder, in words, never as a path. Say nested folders with "inside", innermost first: "the route file in the chat folder, inside api". Never join folder names with commas, because that sounds like a list. Mention a file type only when it helps: "the Python file", "the stylesheet".
- Write things the way the voice should say them. Acronyms go in capitals even when a folder is lowercase: "the UI folder", "ID", "IDs", "API". Product names go without dots: "Next JS", "Node JS", "the package JSON file". Library names go in words: react-router-dom is "React Router DOM". Spell names a voice would mangle the way they're said: "shad C N". Write abbreviations out: "utilities", "git ignore", "text area". Say numbers the way developers do: "port eighty eighty", "version three point eleven".
- Put on-screen text last in its sentence, after a colon, with no quotation marks: "the button says: Publish article." Never continue the sentence after it.
- The listener can't see the screen, so never use visual cues like "as you can see", "at the top", "below" or "near the bottom". Point to things by what they do: "where the routes are listed", "the last thing the file does".
- The first time the tour uses a programming, framework or web term, gloss it in a few plain words in the same sentence: "a reducer, the function that decides how the shared data changes", "a slug, the short web-address version of a title". You're told which terms the listener has already had explained; for those, a reminder of three words at most. Never defer a term with "we'll get to that later". If a term isn't worth glossing, describe the behaviour instead of naming it.
- Avoid parentheses; use another sentence instead. Don't recite line counts or line numbers.

Accuracy:
- Check before you claim. Before you state a count, count the items in the code; if you're going to name them anyway, drop the number. Before you say "every", "all", "only", "each" or "never", make sure the code shows it.
- Trace a value from where it's set to where it's used before you say what it does. If it starts empty, is never used, or gets overridden, say that instead.
- When you describe a check, guard or fallback, confirm it can fire: follow the exact name or path it reads to where that value is written, including the key it's stored or registered under. If they don't line up, it's a bug; say so instead of describing the protection.
- Follow the failure path as well as the success path of every request, save or submit: what the code does when it fails, and what the user sees. Code that reads fields of a result without checking for an error first is a bug worth a sentence.
- Describe things in the order they run, not the order they appear in the file. Say exactly how a check behaves: a hard stop or a skip, a real network call or a stand-in, and what the user sees when it triggers.
- When an effect depends on framework or browser behaviour you can't confirm, say what the code is meant to do.
- You're shown excerpts from related files: ones this file uses, ones that use it, and ones that share its action names, keys, fields or settings. State what those excerpts show as plain fact, naming the file. About a file you aren't shown, say only what this file proves. Never assume a connection because of the order of the tour.
- Claims like "the one place", "nothing else needs touching" or "never" about other files need support in the code you were shown; otherwise leave them out. For "never" or "always" claims about what the user sees, check what shows while data is still loading.
- Hedge only two kinds of thing: why someone wrote the code, when nothing says, and behaviour outside the repository, such as the backend or a library. Use "probably" at most twice in a part. Never hedge what code in this repository does: read it in the excerpts, or leave it out. If an earlier part stated something as fact, don't hedge it now.
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
  /** Which files hand things to which, for related-code excerpts. */
  links: LinkIndex;
  /** How each narrated file is referred to aloud, so every part uses the same name. */
  spoken: Map<string, string>;
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
    links: buildLinkIndex(ingest.files),
    spoken: spokenFileNames(plan.sections.flatMap((s) => (s.kind === "file" ? [s.path] : s.paths))),
  };
}

const GENERIC_BASES = new Set(["index", "route", "page", "layout", "main", "mod", "init", "__init__", "types", "utils", "helpers", "constants", "config", "server", "client", "handler", "handlers", "schema", "models", "views", "urls", "settings", "app", "lib", "default"]);

/** Folders that say what kind of thing a file is: a file in reducers is a reducer. */
const KIND_FOLDERS: Record<string, string> = {
  components: "component",
  reducers: "reducer",
  hooks: "hook",
  services: "service",
  models: "model",
  controllers: "controller",
  routes: "route",
  pages: "page",
  stores: "store",
  slices: "slice",
  middlewares: "middleware",
  schemas: "schema",
  views: "view",
  screens: "screen",
  layouts: "layout",
  providers: "provider",
  contexts: "context",
  actions: "actions file",
  selectors: "selectors file",
};

/** "articleList" → "article list"; "CommentInput" → "Comment Input"; "src" → "source". */
function words(name: string) {
  const stem = name.replace(/\.[^.]+$/, "").replace(/^_+|_+$/g, "");
  const spaced = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\bsrc\b/g, "source")
    .trim();
  return /^[a-z]/.test(stem) ? spaced.toLowerCase() : spaced;
}

/**
 * One spoken name per narrated file, so every part calls it the same thing:
 * "the agent file", "the common reducer", "the Header component", "the index
 * file in the Article folder", "the top-level reducer file" when a reducers
 * folder sits beside it.
 */
export function spokenFileNames(paths: string[]): Map<string, string> {
  const dirs = new Set(paths.flatMap((p) => p.split("/").slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join("/"))));
  const first = new Map<string, string>();
  const withFolder = new Map<string, string>();
  for (const p of paths) {
    const parts = p.split("/");
    const file = parts[parts.length - 1];
    const stem = file.replace(/\.[^.]+$/, "");
    const base = words(file);
    const folderName = parts.length > 1 ? parts[parts.length - 2] : "";
    const folder = folderName ? words(folderName) : "";
    const parent = parts.slice(0, -1).join("/");
    const kindFolder = parts.slice(-3, -1).reverse().find((d) => KIND_FOLDERS[d.toLowerCase()]);
    const kind = kindFolder ? KIND_FOLDERS[kindFolder.toLowerCase()] : null;
    const siblingDir = [stem, `${stem}s`].some((d) => dirs.has(parent ? `${parent}/${d}` : d));
    const inFolder = folder ? `the ${base} file in the ${folder} folder` : `the ${base} file`;
    let name: string;
    const positional = /^(index|route|page|layout|main|mod|init|__init__|default)$/i.test(stem);
    if (GENERIC_BASES.has(stem.toLowerCase()) && (positional || !kind)) name = inFolder;
    else if (siblingDir) name = `the top-level ${base} file`;
    else if (kind && !base.toLowerCase().endsWith(kind)) name = `the ${base} ${kind}`;
    else name = `the ${base} file`;
    first.set(p, name);
    withFolder.set(p, name === inFolder ? inFolder : `${name} in the ${folder} folder`);
  }
  // Two files that would sound the same get their folder said too.
  const counts = new Map<string, number>();
  for (const n of first.values()) counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) ?? 0) + 1);
  return new Map([...first].map(([p, n]) => [p, (counts.get(n.toLowerCase()) ?? 0) > 1 ? withFolder.get(p)! : n]));
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
  "Connect this part to an earlier one only where something real passes between them: say what is handed over and by which file, inside a sentence about this file's own work. At most two such links in a part. Never add one just to place a file, and never use stock phrases like \"we heard about earlier\" or \"we covered earlier\"; the file's name is enough.",
  "Don't re-explain a mechanism, pattern or warning an earlier part already explained, such as how requests are handled or a deprecation; name it in a few words and move on to what's new here. Don't repeat a change recipe an earlier part gave; mention only the step that lives in this file.",
  "Never say the listener has heard about something that isn't listed as covered, never say \"we're about to\", and never make sweeping claims like \"everything so far\".",
  "Let the last paragraph carry the most useful point for a builder, said plainly. Don't label it with \"The takeaway\", \"The upshot\", \"Bottom line\" or \"In short\", don't restate what the part already said, and don't announce the next part; the tour announces each part.",
];

/** What the listener has already heard, from the parts that are finished. */
function heardSoFar(ctx: PromptContext, i: number, earlier: Map<string, SectionResult>): string {
  const done = ctx.plan.sections
    .slice(0, i)
    .map((sec, n) => ({ n, sec, r: earlier.get(sec.id) }))
    .filter((x): x is { n: number; sec: PlanSection; r: SectionResult } => Boolean(x.r));
  if (!done.length) return "";
  // Newest parts matter most; older ones shrink to their first sentence if space runs short.
  let budget = 12_000;
  const lines: string[] = [];
  for (const { n, r } of [...done].reverse()) {
    const recent = i - n <= 8;
    const summary = recent ? r.summary : firstSentence(r.summary);
    const tip = recent && r.changes ? `\n   Tip it gave: ${clip(r.changes, 260)}` : "";
    const line = `${n + 1}. ${r.title} (${r.paths.length > 2 ? `${r.paths.slice(0, 2).join(", ")} and more` : r.paths.join(", ")}): ${clip(summary, 320)}${tip}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    lines.unshift(line);
  }
  return `What the listener has already heard in the parts before this one, with the facts each established. Treat these as settled: don't contradict them, don't hedge them, and don't explain them again:\n<heard>\n${lines.join("\n")}\n</heard>`;
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function firstSentence(text: string) {
  return text.match(/^[^.!?]+[.!?]/)?.[0] ?? text;
}

function tourPosition(ctx: PromptContext, id: string, earlier: Map<string, SectionResult> = new Map()): string {
  const i = ctx.plan.sections.findIndex((s) => s.id === id);
  if (i === -1) return "";
  const total = ctx.plan.sections.length;
  const outline = ctx.plan.sections
    .map((s, n) => {
      const say = s.kind === "file" ? ctx.spoken.get(s.path) : undefined;
      return `${n + 1}. ${sectionLabel(s)}${say ? ` (say: ${say})` : ""}${n === i ? "   <- this part" : ""}`;
    })
    .join("\n");
  const lines = [
    `This is part ${i + 1} of ${total}. The listener has already heard an introduction to the whole app, so don't re-explain what the app is. You may mention that something comes up later only if it's in the outline below.`,
  ];
  const explained = new Set(ctx.terms);
  for (const sec of ctx.plan.sections.slice(0, i)) for (const t of earlier.get(sec.id)?.terms ?? []) explained.add(t);
  if (explained.size) {
    lines.push(
      `Terms the listener has already had explained: ${[...explained].slice(0, 40).join(", ")}. Don't explain them again; a few words of reminder at most.`,
    );
  }
  const heard = heardSoFar(ctx, i, earlier);
  if (heard) lines.push(heard);
  const recency: string[] = [];
  if (i > 0) recency.push(`Immediately before this part: ${sectionLabel(ctx.plan.sections[i - 1])}.`);
  if (i === 0) recency.push("This is the first part after the introduction.");
  if (i < total - 1) recency.push(`Coming up next: ${ctx.plan.sections.slice(i + 1, i + 3).map(sectionLabel).join("; then ")}.`);
  recency.push("Every part before this one in the outline has been heard, even if it isn't summarised above; nothing after it has.");
  if (i === total - 1) {
    recency.push(
      "This is the last part before the closing guide, which covers where to make changes and wraps up the tour. Don't add a wrap-up or where-to-start advice of your own.",
    );
  }
  lines.push(recency.join("\n"));
  lines.push(`The whole tour, in listening order, with the spoken name to use for each file:\n<tour>\n${outline}\n</tour>`);
  return lines.join("\n\n");
}

function relatedBlock(excerpts: RelatedExcerpt[]): string {
  if (!excerpts.length) return "";
  const blocks = excerpts.map((e) => `<related path="${e.path}" why="${e.why}">\n${e.text}\n</related>`);
  return `Code from related files, trimmed to the lines that touch this file's names. Use it to state hand-offs as fact:\n${blocks.join("\n")}`;
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

TERMS: the programming or web terms you explained in this part, comma separated, or "none".

SUMMARY: two or three plain sentences for the introduction and for later parts: what this part covers, which files use it or are used by it, and the facts it established that other parts might touch, such as what it hands to whom and the names of keys, actions or settings it owns. Describe how the code connects, not the order of the tour, and include only what the narration actually says, with the same counts.`;

// ─── Per-file ───────────────────────────────────────────────────────────────

export function fileMessages(
  ctx: PromptContext,
  section: FileSection,
  chunk: Chunk,
  earlierParts: string[] = [],
  earlier: Map<string, SectionResult> = new Map(),
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
            ? "Give one to three change pointers a builder could act on without guessing, depending on how much this file controls. Each names the change they'd want, the exact function, setting or value to search for, and every other place that has to change with it: a second copy of the same list, a matching ID in another file, a flag that controls whether it shows, a backend that must accept a new field, a step that registers the new thing. If one of those places is in another file, name it and say what to change there. A partial recipe is worse than none. Test each recipe by following it literally: check every place that writes or resets the value it depends on, every copy of a hard-coded value, including ones inside strings and web addresses, every piece of code that reads results by position, and every link to something being removed. Don't use something the app already has as the example of a new feature. Consider removing a feature, not only adding one. Bring each one in the way a friend would, starting from the goal, like \"To show twenty articles a page…\" or \"If you'd rather sign people in with a magic link…\", never with a heading-like sentence. Stock lead-ins such as \"Say you want\" and \"The catch is\" wear thin over a long tour, so don't use them."
            : "If this part holds an obvious place to change something a builder would care about, point it out, including any trap.",
          "Only say \"this is where you change X\" if X is actually written in this file. If this file just uses something defined elsewhere, such as prompt text, a model list, theme colours or error wording, send them to that file instead. Name the hard-coded values a builder is likely to hit, such as timeouts, page sizes, ports and delays, with the value in words.",
          "Skip trivial details like import lists, boilerplate, type annotations and commented-out code.",
        ];
  if (isFirstChunk) instructions.push(BANNED_OPENINGS);
  instructions.push(...FLOW_RULES, target(perChunk));

  const user = [
    contextBlock(ctx),
    tourPosition(ctx, section.id, earlier),
    about.join("\n"),
    relatedBlock(relatedExcerpts(ctx.links, file.path, { total: ctx.budget.relatedChars })),
    `<file path="${file.path}">\n${chunk.text}\n</file>`,
    `Write the narration for ${chunk.total > 1 ? "this part of the file" : "this file"}.\n- ${instructions.join("\n- ")}`,
    REPLY_FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n");

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
    "Say how to get the app running, what these settings reveal about how it's built, and whether it has tests, using the facts given. Cover the framework and the few libraries that matter most, in plain words, any runtime version the build tools need, and how it's deployed. Account for every script and dev dependency before summing up, and mention a missing tool only if its absence changes what the listener should do. Point out any file that instructs AI coding assistants, such as Cursor rules or a CLAUDE file, and what it tells them. For each environment variable, say its name in words, which feature uses it, and whether it's optional; never its value.",
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

/** Related code for a group: the best link or two for each of its first few files. */
function groupRelated(ctx: PromptContext, section: GroupSection): RelatedExcerpt[] {
  const inGroup = new Set(section.paths);
  const out: RelatedExcerpt[] = [];
  let used = 0;
  for (const p of section.paths.slice(0, 8)) {
    for (const e of relatedExcerpts(ctx.links, p, { maxFiles: 2, perFile: 500, total: 900 })) {
      if (inGroup.has(e.path) || out.some((o) => o.path === e.path) || used + e.text.length > ctx.budget.relatedChars * 0.7) continue;
      out.push(e);
      used += e.text.length;
    }
  }
  return out;
}

function groupFacts(ctx: PromptContext, section: GroupSection): string {
  if (section.groupKind !== "config") return "";
  const tests = [...ctx.files.values()].filter((f) => f.category === "test").length;
  return tests
    ? `Facts: the repository has ${tests} test file${tests === 1 ? "" : "s"}.`
    : "Facts: the repository has no test files, so every change has to be checked by hand.";
}

export function groupMessages(ctx: PromptContext, section: GroupSection, earlier: Map<string, SectionResult> = new Map()): ChatMessage[] {
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
    tourPosition(ctx, section.id, earlier),
    `This part covers ${section.paths.length} file${section.paths.length === 1 ? "" : "s"} together, because they're ${section.description}. A working title is "${section.title}".`,
    groupFacts(ctx, section),
    relatedBlock(groupRelated(ctx, section)),
    blocks.join("\n\n"),
    `Write one short section about these files as a whole.\n- Open with the one idea that ties them together, said as something that happens in the app, in a sentence the listener can hold onto. For example: "each page fills its own slot when you arrive and empties it when you leave."\n- Then name at most three files, the ones that control behaviour. For each, say where it shows up for the user and one concrete thing you'd change there, with the name to search for. Cover the rest in one sentence by what they do together. Never give every file its own sentence.\n- If a piece is a generic building block and the app has its own file built on it, say which one to open for which kind of change.\n- ${GROUP_GUIDANCE[section.groupKind]}\n- Don't open with "This group", "These files", "Everything we've covered so far" or a count of files.\n- ${FLOW_RULES.slice(1).join("\n- ")}\n- ${target(ctx.budget.groupWords)}`,
    REPLY_FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n");

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
function chapterListing(results: SectionResult[]): { text: string; count: number } {
  const counts: { title: string; n: number }[] = [];
  for (const r of results) {
    if (!r.chapter) continue;
    const title = r.chapterTitle ?? chapterTitle(r.chapter);
    const last = counts[counts.length - 1];
    if (last && last.title === title) last.n++;
    else counts.push({ title, n: 1 });
  }
  return { text: counts.map((c) => `${c.title} (${c.n} part${c.n === 1 ? "" : "s"})`).join("; "), count: counts.length };
}

/** Rough listening time for the whole script, at about 150 words a minute. */
function estimateMinutes(ctx: PromptContext, results: SectionResult[]): number {
  const bodyWords = results.reduce((n, r) => n + r.body.split(/\s+/).length, 0);
  const extra = (ctx.budget.overviewWords[1] + ctx.budget.closingWords[1]) * 0.85;
  return Math.max(5, Math.round((bodyWords + extra) / 150 / 5) * 5);
}

export function overviewMessages(ctx: PromptContext, results: SectionResult[]): ChatMessage[] {
  const chapters = chapterListing(results);
  const minutes = estimateMinutes(ctx, results);
  const user = [
    contextBlock(ctx),
    `The rest of the walkthrough has already been written. Here is the tour, in the order the listener will hear it, with a summary of each part:\n<tour>\n${tourListing(results)}\n</tour>`,
    `Now write the introduction that plays first, before the tour.
- Begin by saying, in a sentence or two, what this app is and what it's for, in plain terms. If it has a product name, use it. Don't greet them with "welcome", and don't mention Talkthrough.
- Right after that, give the shape of the tour in two or three sentences: it runs about ${minutes} minutes${chapters.count ? ` in ${chapters.count} chapters: ${chapters.text}` : ""}. Use the chapters as the main areas of the app, so the structure is described once. Say each chapter's title inside a frame, like "the first chapter, Where it all starts, covers…", never as the subject of a sentence.
- Then follow one or two realistic things a person does with the app, at the level of what they see and which areas take turns. Name the piece that does each job, using the names the parts use, but leave how it works, such as checks, guards, storage keys and error handling, to the parts.
- Mention the key technologies in a sentence or two, in plain words, and why they matter here.${
      ctx.terms.length
        ? `\n- The parts that follow rely on you to define these terms, so explain each one briefly, once, where it first comes up naturally: ${ctx.terms.join(", ")}.`
        : ""
    }
- Only promise what the tour delivers.
- Keep it flowing as speech: no lists of more than three things, and no stock phrases.
- ${target(ctx.budget.overviewWords)}`,
    `Reply with a first line "NAME: " followed by the app's name as you'd say it aloud, such as "Conduit" or "the Acme dashboard", then the narration as plain paragraphs. No title line and no summary line.`,
  ].join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

export function closingMessages(ctx: PromptContext, results: SectionResult[], overview = ""): ChatMessage[] {
  const user = [
    contextBlock(ctx, { tree: true }),
    overview ? `The introduction the listener heard first:\n<introduction>\n${overview}\n</introduction>` : "",
    `Here is the walkthrough the listener has just heard, part by part, with the change notes each part made:\n<tour>\n${tourListing(results, { changes: true })}\n</tour>`,
    `Now write the closing part of the walkthrough: a practical guide to where you'd go to change things, and the end of the tour.
- Open with two or three sentences that bring back the big picture from the introduction, through one of its stories.
- Choose the five to seven changes someone building on this particular app is most likely to want, such as changing the look, adding a page or screen, changing what the AI says, adding a field to the data, adjusting a limit, or adding an integration. Pick ones that fit this app, and include how to remove or switch off a feature if that fits.
- The listener has usually heard each recipe already. Name the goal and the file in one sentence, and add only what no single part could say: the other files that must change with it, and in what order. Never repeat a sentence or recipe from the tour.
- Base every suggestion on what the parts actually said, especially their change notes. Don't contradict them, and don't hedge where a part was specific.
- Mention anything to be careful about, such as things that must change together, or settings that live outside the code like environment variables.
- If the parts noticed bugs or rough edges, gather the most important ones into one short paragraph of things worth fixing first. Rank them by what a user would notice today, and keep each one's status as the part gave it: a bug now, or a risk only after an upgrade.
- Talk it through as advice from a friend, not as a list: vary how each suggestion begins, and never number them.
- End with one concrete first change to try, then a final sentence that makes clear the tour is over. Keep it genuine, not cheesy.
- ${target(ctx.budget.closingWords)}`,
    "Reply with just the narration, as plain paragraphs. No title line and no summary line.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
