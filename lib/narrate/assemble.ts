/**
 * Turns a finished walkthrough into the two things people take away:
 * a listening script for a text-to-speech app, and a Markdown document for
 * reading and reference (with file paths, which the script leaves out).
 */
import { chapterTitle, type SectionResult, type Walkthrough } from "./types";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 42 → "forty-two". Numbers in words read naturally in any voice. */
export function numberWords(n: number): string {
  if (n < 0 || !Number.isInteger(n)) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${numberWords(n % 100)}` : ""}`;
  return String(n);
}

function sentence(text: string) {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function repoLabel(w: Walkthrough) {
  return `${w.repo.owner}/${w.repo.repo}${w.repo.subpath ? ` (${w.repo.subpath})` : ""}`;
}

/** "react-redux_app" → "react redux app": how a person would say a repo name. */
export function spokenName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_./]+/g, " ")
    .trim();
}

export type Chapter = { title: string; bridge?: string; sections: { section: SectionResult; number: number }[] };

/**
 * Groups parts into the tour's chapters. Walkthroughs saved before chapters
 * existed come back as a single untitled chapter.
 */
export function chaptersOf(w: Walkthrough): Chapter[] {
  const chapters: (Chapter & { id: string })[] = [];
  w.sections.forEach((section, i) => {
    const id = section.chapter ?? "";
    const title = section.chapter ? (section.chapterTitle ?? chapterTitle(section.chapter)) : "";
    const last = chapters[chapters.length - 1];
    if (last && last.id === id) last.sections.push({ section, number: i + 1 });
    else chapters.push({ id, title, bridge: section.bridge, sections: [{ section, number: i + 1 }] });
  });
  return chapters.map(({ title, bridge, sections }) => ({ title, bridge, sections }));
}

const CLOSING_LINE = "Last stop. Where to go when you want to change something.";

/** Plain text written to be read aloud: no symbols, no paths, spoken chapter headings. */
export function toListeningText(w: Walkthrough): string {
  const parts: string[] = [sentence(`A guided tour of ${w.name ?? spokenName(w.repo.repo)}`), w.overview.trim()];
  const chapters = chaptersOf(w);
  const titled = chapters.some((c) => c.title);
  chapters.forEach((chapter, c) => {
    if (titled && chapter.title) parts.push(`Chapter ${numberWords(c + 1)}. ${sentence(chapter.title)}`);
    if (titled && chapter.bridge) parts.push(chapter.bridge.trim());
    // A chapter of one part needs no second heading.
    const lone = titled && chapter.sections.length === 1;
    for (const { section, number } of chapter.sections) {
      // A spoken number marks the boundary; a bare title can sound like a stray sentence.
      if (!lone) parts.push(`Part ${numberWords(number)}. ${sentence(section.title)}`);
      parts.push(section.body.trim());
    }
  });
  if (w.closing.trim()) {
    parts.push(CLOSING_LINE);
    parts.push(w.closing.trim());
  }
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

/** A readable document with headings and the file paths each part covers. */
export function toMarkdown(w: Walkthrough): string {
  const date = new Date(w.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [
    `# ${w.title}`,
    "",
    `*A spoken walkthrough of [${repoLabel(w)}](${w.repo.htmlUrl}), written by Talkthrough with \`${w.model}\` on ${date}.*`,
    "",
    "## The big picture",
    "",
    w.overview.trim(),
  ];
  const chapters = chaptersOf(w);
  const titled = chapters.some((c) => c.title);
  chapters.forEach((chapter, c) => {
    if (titled && chapter.title) lines.push("", `## Chapter ${c + 1}: ${chapter.title}`);
    if (titled && chapter.bridge) lines.push("", `*${chapter.bridge.trim()}*`);
    for (const { section: s, number } of chapter.sections) {
      lines.push("", `${titled ? "###" : "##"} ${number}. ${s.title}`, "");
      const paths = s.paths.length > 8 ? [...s.paths.slice(0, 8), `and ${s.paths.length - 8} more`] : s.paths;
      lines.push(paths.map((p) => (p.startsWith("and ") ? p : `\`${p}\``)).join(" · "), "", s.body.trim());
    }
  });
  if (w.closing.trim()) lines.push("", "## Where to make changes", "", w.closing.trim());
  if (w.missing.length) {
    lines.push("", "---", "", `*Not included because they couldn't be generated: ${w.missing.map((m) => m.label).join(", ")}.*`);
  }
  return `${lines.join("\n")}\n`;
}

export type ScriptStats = { words: number; characters: number; minutes: number };

/** Speech runs at roughly 150 words a minute. */
export function scriptStats(text: string): ScriptStats {
  const words = text.split(/\s+/).filter(Boolean).length;
  return { words, characters: text.length, minutes: Math.max(1, Math.round(words / 150)) };
}

export function fileSlug(w: Walkthrough) {
  return `${w.repo.owner}-${w.repo.repo}${w.repo.subpath ? `-${w.repo.subpath}` : ""}-talkthrough`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-");
}
