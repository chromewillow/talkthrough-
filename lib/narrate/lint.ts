/**
 * Mechanical checks on a drafted part, run before it's revised. Each flag
 * quotes the sentence and says what's wrong, so the revision can fix exactly
 * that. Nothing here rewrites text: the model does, with the code in view.
 */

export type EarlierPart = { number: number; title: string; body: string };

const SCREEN_POINTERS = /\b(listed here|this list|that line|that spot|shown here|as shown|isn't shown|is shown below|above|below|on screen here)\b/i;
const SPOKEN_DOT = /\b(?!dot\b)\w+ dot (?!env\b|com\b|org\b|io\b|net\b)\w+\b/i;
const CASE_POINT = /\b(lower ?case|upper ?case|capital letters?|capitali[sz]ed|small letters?|starts with a capital)\b/i;
const HEDGES = /\b(probably|likely|seems to|presumably|it appears)\b/i;
const SIGNPOSTS = /\b(the catch is|worth knowing|rough edge|one thing to watch|keep in mind|it's worth noting)\b/gi;

export function sentencesOf(text: string): string[] {
  return (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”')]*/g) ?? []).map((s) => s.trim()).filter((s) => s.split(" ").length >= 4);
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

function grams(s: string, n = 4): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return shared / (a.size + b.size - shared);
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

  const earlierSentences = earlier.flatMap((p) => sentencesOf(p.body).map((s) => ({ s, g: grams(s), n: p.number })));
  let repeats = 0;
  for (const s of sentences) {
    if (SCREEN_POINTERS.test(s)) flags.push(`${quote(s)} points at something on a screen the listener can't see.`);
    if (SPOKEN_DOT.test(s)) flags.push(`${quote(s)} reads code aloud; say what it does instead.`);
    if (CASE_POINT.test(s)) flags.push(`${quote(s)} makes a point the ear can't catch; say what the difference does.`);
    if (HEDGES.test(s)) flags.push(`${quote(s)} hedges; settle it from the code shown, or cut it.`);
    if (repeats < 4) {
      const g = grams(s);
      const twin = earlierSentences.find((e) => jaccard(g, e.g) >= 0.5);
      if (twin) {
        repeats++;
        flags.push(`${quote(s)} repeats part ${twin.n}, which said ${quote(twin.s)}. Cut it, or say only what's new.`);
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
  return [...new Set(flags)].slice(0, 14);
}
