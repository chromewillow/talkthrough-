/**
 * Mechanical checks on a drafted part, run before it's revised. Each flag
 * quotes the sentence and says what's wrong, so the revision can fix exactly
 * that. Nothing here rewrites text: the model does, with the code in view.
 */

export type EarlierPart = { number: number; title: string; body: string };

const SCREEN_POINTERS = /\b(listed here|this list|that line|that spot|above|below|on screen here)\b/i;
const SHOWN = /\b(shown here|as shown|isn't shown|is shown below|you were shown|we can see here)\b/i;
const SPOKEN_DOT = /\b(?!dot\b)\w+ dot (?!env\b|com\b|org\b|io\b|net\b)\w+\b/i;
const CASE_POINT = /\b(lower ?case|upper ?case|capital letters?|capitali[sz]ed|small letters?|starts with a capital)\b/i;
const HEDGES = /\b(probably|likely|seems to|presumably|it appears)\b/i;
const SIGNPOSTS = /\b(the catch is|worth knowing|rough edge|one thing to watch|keep in mind|it's worth noting)\b/gi;
const BACK_REFERENCE = /\b(already flagged|flagged (?:earlier|in the)|as (?:mentioned|flagged|we saw)|the same (?:bug|rule|steps|recipe) as|those same steps)\b/i;
const FOLDER_OPENER = /^The [A-Z][\w ]{0,40}?,? in the [\w ]{1,30} folder\b/;

const STOP = new Set(
  (
    "a an the and or but so if then than that this these those it its it's is are was were be been being to of in on at by for with from as into " +
    "when while which who whom what where why how not no nor too very can could would should will just only also there here they them their you your " +
    "we our us he she his her has have had do does did done one two any each every all some more most other such same own about over under again " +
    "out up down off once both few because until before after through during"
  ).split(" "),
);

export function sentencesOf(text: string): string[] {
  return (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”')]*/g) ?? []).map((s) => s.trim()).filter((s) => s.split(" ").length >= 4);
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

function stem(w: string) {
  return w.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, "");
}

/** The meaning-carrying words of a sentence, roughly stemmed. */
export function contentWords(s: string): Set<string> {
  return new Set(
    words(s)
      .filter((w) => !STOP.has(w) && w.length > 2)
      .map(stem),
  );
}

function overlap(a: Set<string>, b: Set<string>): { shared: number; ratio: number } {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return { shared, ratio: shared / Math.max(1, Math.min(a.size, b.size)) };
}

function quote(s: string) {
  return s.length > 160 ? `"${s.slice(0, 157)}…"` : `"${s}"`;
}

export function openingOf(body: string, n = 3): string {
  return words(body).slice(0, n).join(" ");
}

/**
 * Flags for one drafted part, given the parts before it (most recent last)
 * and the terms the listener already has explained.
 */
export function lintPart(body: string, earlier: EarlierPart[], explainedTerms: string[] = []): string[] {
  const flags: string[] = [];
  const sentences = sentencesOf(body);

  const opening = openingOf(body);
  const sameStart = earlier.slice(-4).find((p) => openingOf(p.body) === opening);
  if (opening && sameStart) flags.push(`It opens with the same words as part ${sameStart.number}: "${opening}…". Open differently.`);
  const folderOpeners = earlier.filter((p) => FOLDER_OPENER.test(p.body.trim())).length;
  if (FOLDER_OPENER.test(body.trim()) && folderOpeners >= 2) {
    flags.push(`It opens "The …, in the … folder", like ${folderOpeners} earlier parts. Open with what the user sees or does, and leave the folder out.`);
  }

  const last = earlier[earlier.length - 1]?.number;
  const earlierSentences = earlier.flatMap((p) => sentencesOf(p.body).map((s) => ({ s, w: contentWords(s), n: p.number })));
  let repeats = 0;
  for (const s of sentences) {
    if (SCREEN_POINTERS.test(s)) flags.push(`${quote(s)} points at something on a screen the listener can't see.`);
    if (SHOWN.test(s)) flags.push(`${quote(s)} talks about what you were shown. State only what the code proves, or cut it; don't turn it into an "only" claim.`);
    if (SPOKEN_DOT.test(s)) flags.push(`${quote(s)} reads code aloud; say what it does instead.`);
    if (CASE_POINT.test(s)) flags.push(`${quote(s)} makes a point the ear can't catch; say what the difference does.`);
    if (HEDGES.test(s)) flags.push(`${quote(s)} hedges; settle it from the code shown, or cut it.`);
    const w = contentWords(s);
    if (BACK_REFERENCE.test(s) && !earlierSentences.some((e) => overlap(w, e.w).shared >= 3)) {
      flags.push(`${quote(s)} refers back to something no earlier part said. Say it in full or cut it.`);
    }
    if (repeats < 8 && w.size >= 4) {
      // A paraphrase still repeats: compare the meaning-carrying words, not the wording.
      const twins = earlierSentences.filter((e) => {
        const o = overlap(w, e.w);
        return o.shared >= 4 && o.ratio >= (e.n === last ? 0.6 : 0.7);
      });
      if (twins.length) {
        repeats++;
        const parts = [...new Set(twins.map((t) => t.n))];
        flags.push(
          `${quote(s)} repeats what the listener heard in part${parts.length > 1 ? "s" : ""} ${parts.join(", ")}, such as ${quote(twins[0].s)}. Cut it to a clause, or say only what's new.`,
        );
      }
    }
  }

  for (const term of explainedTerms) {
    const re = new RegExp(`\\b(?:a|an|the) ${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?, (?:the|a|an|which|meaning) `, "i");
    const hit = sentences.find((s) => re.test(s));
    if (hit) flags.push(`${quote(hit)} explains "${term}" again; the listener already knows it.`);
  }

  // Signposts the tour has already leaned on twice.
  const used = new Map<string, number>();
  for (const p of earlier) for (const m of p.body.matchAll(SIGNPOSTS)) used.set(m[0].toLowerCase(), (used.get(m[0].toLowerCase()) ?? 0) + 1);
  for (const m of body.matchAll(SIGNPOSTS)) {
    const k = m[0].toLowerCase();
    if ((used.get(k) ?? 0) >= 2) flags.push(`"${m[0]}" has already been used ${used.get(k)} times in the tour; find another way in, or none.`);
  }
  return [...new Set(flags)].slice(0, 20);
}
