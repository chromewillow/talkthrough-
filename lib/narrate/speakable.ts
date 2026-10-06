/**
 * Last line of defence for the ear. The prompts ask for plain spoken prose,
 * but models slip — a stray bullet, some bold, a code fence. This strips
 * anything a text-to-speech voice would read out awkwardly.
 */

function endSentence(text: string): string {
  const t = text.trim();
  return /[.!?…:;"”')]$/.test(t) ? t : `${t}.`;
}

export function toSpeakable(input: string): string {
  let t = input.replace(/\r\n?/g, "\n");

  // Code never reads well aloud: drop fenced blocks entirely.
  t = t.replace(/```[\s\S]*?(```|$)/g, "").replace(/~~~[\s\S]*?(~~~|$)/g, "");
  // HTML tags and comments.
  t = t.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^>\n]*>/g, "");
  // Headings become their own sentence.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_, h: string) => endSentence(h));
  // Horizontal rules.
  t = t.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "");
  // Table separator rows vanish; table rows become comma-separated phrases.
  t = t.replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, "");
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row: string) =>
    endSentence(
      row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join(", "),
    ),
  );
  // List items become sentences.
  t = t.replace(/^[ \t]*(?:[-*+•▪◦]|\d{1,3}[.)])[ \t]+(.+)$/gm, (_, item: string) => endSentence(item));
  // Block quotes.
  t = t.replace(/^[ \t]*>[ \t]?/gm, "");
  // Images and links keep their words.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Bold and italics.
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/g, "$2");
  t = t.replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, "$1$2");
  t = t.replace(/(^|[^\w])_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/g, "$1$2");
  // Inline code keeps its text, without the backticks.
  t = t.replace(/`+([^`\n]+?)`+/g, "$1").replace(/`/g, "");
  // Symbols a voice stumbles over.
  t = t.replace(/[ \t]*(?:->|→|=>|⟶)[ \t]*/g, " to ");
  t = t.replace(/[ \t]+&[ \t]+/g, " and ");
  t = t.replace(/\be\.g\.,?/gi, "for example,").replace(/\bi\.e\.,?/gi, "that is,");
  t = t.replace(/\betc\.(?=\s*[A-Z]|\s*$)/g, "and so on.").replace(/\betc\./gi, "and so on");
  t = t.replace(/\bvs\.?(?=\s)/gi, "versus");
  t = t.replace(/\s~\s?(\d)/g, " about $1");
  // Product and file names with dots: "Next.js" → "Next JS", "package.json" → "package JSON".
  t = t.replace(/\b([A-Za-z][\w-]*)\.js\b/g, "$1 JS").replace(/\b([A-Za-z][\w-]*)\.json\b/g, "$1 JSON");
  // Code names a voice would spell out or mash together: SET_PAGE, mapDispatchToProps.
  t = t.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, screamingToWords);
  t = t.replace(/\b[a-z][a-z0-9]*(?:[A-Z]+[a-z0-9]*)+\b/g, camelToWords);
  // Joined-up names a voice may run together: "CommentInput" → "Comment Input".
  t = t.replace(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g, (w: string) => (JOINED_KEEP.has(w) ? w : w.replace(/([a-z0-9])([A-Z])/g, "$1 $2")));
  // Action names written without underscores: "APP LOAD", "LOGIN".
  t = t.replace(/\b[A-Z][A-Z0-9]{2,}(?:[ \t]+[A-Z][A-Z0-9]{1,})*\b/g, shoutedToWords);
  // Trailing-off dots: "here... yet" → "here, yet".
  t = t.replace(/(\w)[ \t]*(?:\.{3}|…)[ \t]+(?=[a-z])/g, "$1, ");
  t = t.replace(/(\w)[ \t]*(?:\.{3}|…)(?=[ \t]*(?:[A-Z\n]|$))/g, "$1.");
  // Folder shorthand a voice reads letter by letter.
  t = t.replace(/(?<![\w/.-])src(?![\w/.-])/g, "source").replace(/(?<![\w/.-])utils(?![\w/.-])/g, "utilities");
  // Lowercase acronyms get read as words ("id" as in Freud); capitals get spelled out.
  // ...except a literal value, like "the key jwt" or a field named id.
  t = t.replace(
    /(?<!\b(?:key|named|called|text|string|value|field|reads|says)\s)\b(id|url|api|json|html|css|ui|sql|jwt|http|https|cli|sdk|llm)(s?)\b/g,
    (_, a: string, plural: string) => a.toUpperCase() + plural,
  );
  t = polishPhrasing(t);
  // Emoji and decorative symbols.
  t = t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "");
  // Stray markdown escapes.
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1");

  // Tidy whitespace: single spaces, paragraphs separated by one blank line.
  t = t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();
  return t;
}

const ACRONYMS = new Set(["API", "URL", "ID", "IDS", "JWT", "HTTP", "HTTPS", "UI", "SQL", "CSS", "HTML", "JSON", "CLI", "SDK", "LLM", "AI", "DB", "AWS", "S3", "DOM", "XML", "PDF", "CSV", "SMS", "OTP", "TTL", "CORS", "CSRF", "OAUTH", "SSO", "MFA", "UUID"]);
/** Brand names written joined up, which read the same either way but look wrong split. */
const JOINED_KEEP = new Set([
  "GitHub", "GitLab", "JavaScript", "TypeScript", "OpenAI", "OpenRouter", "ElevenLabs", "PostgreSQL", "MySQL", "MongoDB", "GraphQL",
  "YouTube", "LinkedIn", "WordPress", "PlayStation", "FastAPI", "DynamoDB", "CloudFlare", "Cloudflare", "DigitalOcean", "PayPal",
  "WhatsApp", "TikTok", "SoundCloud", "DeepSeek", "LangChain", "LlamaIndex", "HuggingFace", "NextAuth", "TanStack", "PlanetScale",
  "SvelteKit", "NestJS", "RxJS", "WebSocket", "WebSockets", "WebAssembly", "PowerShell", "VSCode", "IntelliJ", "PyTorch", "TensorFlow",
  "SQLite", "NoSQL", "MariaDB", "OAuth", "ClickHouse", "CockroachDB", "BigQuery", "RedHat", "MacBook", "AirPods", "FaceTime",
]);
const CAMEL_KEEP = new Set(["iPhone", "iPad", "iOS", "iPadOS", "macOS", "watchOS", "tvOS", "visionOS", "eBay", "jQuery", "tRPC", "gRPC", "iCloud", "pH"]);

const KEEP_CAPS = new Set([...ACRONYMS, "README", "TODO", "CRUD", "REST", "YAML", "TOML", "HTMX", "GRPC", "NASA", "UTF", "ASCII", "GPU", "CPU", "RAM", "SSD", "MVP", "SaaS", "FAQ", "GDPR", "ESM", "CJS", "NPM", "PNPM", "RSS", "SVG", "PNG", "JPEG", "GIF", "MP3", "MP4", "WASM", "SEO", "OK", "TV", "US", "UK", "EU", "AM", "PM", "USD", "GPT", "LLMS", "APIS", "URLS", "SDKS", "UIS", "PDFS", "CSVS"]);

/**
 * "APP LOAD" → "app load", "LOGIN" → "login": capitals read as shouting or
 * get spelled out. Known acronyms keep their capitals, and a lone short word
 * like "JWT" is left alone.
 */
export function shoutedToWords(run: string): string {
  const words = run.split(/[ \t]+/);
  if (words.length === 1 && (words[0].length <= 3 || KEEP_CAPS.has(words[0]))) return run;
  if (words.every((w) => KEEP_CAPS.has(w))) return run;
  return words.map((w) => (KEEP_CAPS.has(w) ? w : w.toLowerCase())).join(" ");
}

/** SET_PAGE → "set page"; NEXT_PUBLIC_API_URL → "next public API URL". */
export function screamingToWords(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? (w === "IDS" ? "IDs" : w) : w.toLowerCase()))
    .join(" ");
}

/** mapDispatchToProps → "map dispatch to props"; innerHTML → "inner HTML". */
export function camelToWords(name: string): string {
  if (CAMEL_KEEP.has(name)) return name;
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((w) => (/^[A-Z][a-z0-9]*$/.test(w) && w.length > 1 ? w.toLowerCase() : w))
    .join(" ");
}

/**
 * Removes the filler and screen-bound phrases the prompts ban but models
 * still slip in now and then. Only unambiguous patterns are touched.
 */
export function polishPhrasing(input: string): string {
  let t = input;
  // "Notice that the list…" → "The list…"
  t = t.replace(/\b(?:Notice|Note) (?:that|how) (\w)/g, (_, c: string) => c.toUpperCase());
  t = t.replace(/,? (?:notice|note) (?:that|how) /g, " ");
  t = t.replace(/\bAs you can see, (\w)/g, (_, c: string) => c.toUpperCase());
  t = t.replace(/,? as you can see,?/gi, "");
  // Filler adverbs.
  t = t.replace(/\b(Simply|Basically),? (\w)/g, (_, _w: string, c: string) => c.toUpperCase());
  t = t.replace(/ (?:simply|basically) /gi, " ");
  // Positions in a file the listener can't see.
  t = t.replace(/\bat the (?:very )?(?:bottom|end) of (?:the|this) file\b/gi, "toward the end of the file");
  t = t.replace(/\b(?:at|near) the (?:very )?top of (?:the|this) file\b/gi, "early in the file");
  // Stock back-references: the file's name already says which one.
  t = t.replace(/\b(?:As|Like) we (?:just )?(?:heard|saw|covered|discussed)(?: about)?(?: (?:earlier|before|already))?, (\w)/g, (_, c: string) => c.toUpperCase());
  t = t.replace(
    /(?<!\b(?:everything|anything|something|all|what|that|this|those|these))(?<=[A-Za-z]) (?:that |which )?we (?:heard about|heard|covered|talked about|met)(?: (?:earlier|before|early on|already|a moment ago))?(?=[\s,.;:])/g,
    "",
  );
  // Labelled morals at the end of a part.
  t = t.replace(/\b(?:The (?:takeaway|upshot|bottom line|short version)|Bottom line|In short)(?: here)?(?: is)?(?: (?:simple|this|that))?[:,] (\w)/g, (_, c: string) => c.toUpperCase());
  t = t.replace(/\bThe (?:takeaway|upshot)(?: here)? is that (\w)/g, (_, c: string) => c.toUpperCase());
  return t;
}

/** Joins lines inside a paragraph so the result is one paragraph per block. */
export function normaliseParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export type ParsedSection = {
  title: string | null;
  body: string;
  summary: string | null;
  changes: string | null;
  terms: string[];
  name: string | null;
  recipes: string[];
  bugs: string[];
  /** Bugs noticed in the code but not told to the listener. */
  noted: string[];
  explained: string[];
  facts: string[];
  /** From the introduction: chapter titles and the bridges into each chapter, by chapter number. */
  chapters: Record<number, string>;
  bridges: Record<number, string>;
};

const TITLE_RE = /^[ \t>*_#]*TITLE[ \t*_]*[:：][ \t*_]*(.+)$/im;
const NAME_RE = /^[ \t>*_#]*NAME[ \t*_]*[:：][ \t*_]*(.+)$/m;
/** Lines after the narration, in any order: "RECIPE: …", "BUGS: …", "SUMMARY: …" and the rest. */
const TRAILER_RE = /^[ \t>*_#]*(CHANGES|TERMS|SUMMARY|RECIPES?|BUGS|NOTED|EXPLAINED|FACTS)[ \t*_]*[:：][ \t*_]*/gim;
const CHAPTER_LINE_RE = /^[ \t>*_#]*(CHAPTER|BRIDGE)[ \t]+(\d{1,2})[ \t*_]*[:：][ \t*_]*(.+)$/gim;

/** "- one\n- two" → ["one", "two"]; "none" → []. */
function lines(value: string | undefined): string[] {
  if (!value || /^none\.?$/i.test(value.trim())) return [];
  return value
    .split("\n")
    .map((l) => cleanInline(l.replace(/^[\s*•-]*(\d{1,2}[.)]\s+)?/, "")))
    .filter((l) => l && !/^none\.?$/i.test(l))
    .slice(0, 20);
}

/** Splits a "TITLE: … / narration / CHANGES / TERMS / SUMMARY" reply into its parts. */
export function parseSectionReply(raw: string): ParsedSection {
  let text = raw.trim();
  // Some models wrap the whole reply in a code fence.
  const fenced = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();

  let title: string | null = null;
  let name: string | null = null;
  // A label can appear more than once ("BUGS: one" then "BUGS: two"); every line counts.
  const found: Record<string, string[]> = {};
  const chapters: Record<number, string> = {};
  const bridges: Record<number, string> = {};

  // The introduction names the chapters and writes the lines that lead into them.
  text = text.replace(CHAPTER_LINE_RE, (_, kind: string, n: string, value: string) => {
    if (kind.toUpperCase() === "CHAPTER") chapters[Number(n)] = cleanInline(value).replace(/[.。]$/, "");
    else bridges[Number(n)] = cleanInline(value);
    return "";
  });

  // Everything from the first trailer label on is trailers; each runs to the next label.
  const labels = [...text.matchAll(TRAILER_RE)];
  if (labels.length) {
    labels.forEach((m, i) => {
      const end = i + 1 < labels.length ? labels[i + 1].index : text.length;
      const key = m[1].toUpperCase().replace(/^RECIPES$/, "RECIPE");
      (found[key] ??= []).push(text.slice(m.index + m[0].length, end).trim());
    });
    text = text.slice(0, labels[0].index).trim();
  }
  const trailers: Record<string, string> = Object.fromEntries(
    Object.entries(found).map(([k, v]) => [k, k === "TERMS" ? v.join(", ") : k === "SUMMARY" ? v.join(" ") : v.join("\n")]),
  );
  // A summary that swallowed a CHANGES note on the same line.
  if (trailers.SUMMARY && !trailers.CHANGES) {
    const inSummary = trailers.SUMMARY.match(/\bCHANGES[ \t*_]*[:：][ \t*_]*(.+)$/i);
    if (inSummary && inSummary.index !== undefined) {
      trailers.CHANGES = inSummary[1].trim();
      trailers.SUMMARY = trailers.SUMMARY.slice(0, inSummary.index).trim();
    }
  }

  const n = text.match(NAME_RE);
  if (n && n.index !== undefined && n.index < 400) {
    name = cleanInline(n[1]).replace(/[.。]$/, "") || null;
    text = (text.slice(0, n.index) + text.slice(n.index + n[0].length)).trim();
  }
  const t = text.match(TITLE_RE);
  if (t && t.index !== undefined && t.index < 400) {
    title = cleanInline(t[1]).replace(/[.。]$/, "");
    // Anything before the TITLE line is chatter like "Sure, here's the narration".
    text = text.slice(t.index + t[0].length).trim();
  }
  // Models that ignore the TITLE line often open with a markdown heading instead.
  if (!title) {
    const heading = text.match(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t#]*$/m);
    if (heading && heading.index !== undefined && heading.index < 5) {
      title = cleanInline(heading[1]).replace(/[.。]$/, "");
      text = text.slice(heading.index + heading[0].length).trim();
    }
  }
  text = text.replace(/^[ \t*_]*(NARRATION|BODY|SCRIPT)[ \t*_]*[:：][ \t]*/im, "");

  const body = normaliseParagraphs(toSpeakable(text));
  const summary = trailers.SUMMARY ? cleanInline(trailers.SUMMARY) : "";
  const changes = trailers.CHANGES ? cleanInline(trailers.CHANGES) : "";
  const terms = trailers.TERMS && !/^none\.?$/i.test(trailers.TERMS.trim())
    ? trailers.TERMS.split(/[,;\n]/)
        .map((x) => x.replace(/^[\s*_"“'-]+|[\s*_"”'.]+$/g, "").toLowerCase())
        .filter((x) => x && x.length <= 40)
        .slice(0, 12)
    : [];
  return {
    title: title ? title.slice(0, 120) : null,
    body,
    summary: summary || null,
    changes: changes && !/^none\.?$/i.test(changes) ? changes : null,
    terms,
    name: name ? name.slice(0, 80) : null,
    recipes: lines(trailers.RECIPE),
    bugs: lines(trailers.BUGS),
    noted: lines(trailers.NOTED),
    explained: lines(trailers.EXPLAINED),
    facts: lines(trailers.FACTS),
    chapters,
    bridges,
  };
}

function cleanInline(s: string): string {
  return toSpeakable(s)
    .replace(/\s+/g, " ")
    .replace(/^["“'‘]+|["”'’]+$/g, "")
    .trim();
}

/** First couple of sentences, used when a model forgets the SUMMARY line. */
export function firstSentences(text: string, max = 2): string {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [text];
  return sentences
    .slice(0, max)
    .map((x) => x.trim())
    .join(" ");
}
