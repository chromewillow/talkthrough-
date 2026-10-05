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
  // Lowercase acronyms get read as words ("id" as in Freud); capitals get spelled out.
  t = t.replace(/\b(id|url|api|json|html|css|ui|sql|jwt|http|https|cli|sdk|llm)(s?)\b/g, (_, a: string, plural: string) => a.toUpperCase() + plural);
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

export type ParsedSection = { title: string | null; body: string; summary: string | null; changes: string | null };

const TITLE_RE = /^[ \t>*_#]*TITLE[ \t*_]*[:：][ \t*_]*(.+)$/im;
const SUMMARY_RE = /^[ \t>*_#]*SUMMARY[ \t*_]*[:：][ \t*_]*([\s\S]+)$/im;
const CHANGES_RE = /^[ \t>*_#]*CHANGES[ \t*_]*[:：][ \t*_]*([\s\S]+)$/im;

/** Splits a "TITLE: … / narration / SUMMARY: …" reply into its parts. */
export function parseSectionReply(raw: string): ParsedSection {
  let text = raw.trim();
  // Some models wrap the whole reply in a code fence.
  const fenced = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();

  let title: string | null = null;
  let summary: string | null = null;
  let changes: string | null = null;

  const s = text.match(SUMMARY_RE);
  if (s && s.index !== undefined) {
    summary = cleanInline(s[1]);
    text = text.slice(0, s.index).trim();
  }
  // CHANGES comes before SUMMARY in the format, but models sometimes swap them.
  const c = text.match(CHANGES_RE);
  if (c && c.index !== undefined) {
    changes = cleanInline(c[1]);
    text = text.slice(0, c.index).trim();
  }
  if (summary) {
    const inSummary = summary.match(/\bCHANGES[ \t*_]*[:：][ \t*_]*(.+)$/i);
    if (inSummary && inSummary.index !== undefined) {
      changes ??= inSummary[1].trim();
      summary = summary.slice(0, inSummary.index).trim();
    }
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
  return {
    title: title ? title.slice(0, 120) : null,
    body,
    summary: summary || null,
    changes: changes && !/^none\.?$/i.test(changes) ? changes : null,
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
