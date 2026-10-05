/**
 * Runs a whole walkthrough in the browser: explain every planned section with
 * a few requests in flight, then write the overview and the closing guide
 * from those explanations. Finished sections are reported as they land, so a
 * failed run can resume without paying for them twice.
 */
import type { IngestResult } from "@/lib/ingest/types";
import { chat, isFatal, LlmError, newSession, withRetries, type LlmErrorKind, type Session, type Transport } from "./llm";
import { sectionLabel, sectionPaths } from "./plan";
import { lintPart, type EarlierPart } from "./lint";
import {
  buildContext,
  chapterRuns,
  closingMessages,
  fileMessages,
  groupMessages,
  overviewMessages,
  revisionMessages,
  type ChatMessage,
  type PromptContext,
} from "./prompts";
import { firstSentences, normaliseParagraphs, parseSectionReply, toSpeakable, type ParsedSection } from "./speakable";
import { chapterTitle, type Chunk, type FileSection, type GroupSection, type LlmSettings, type NarrationOptions, type NarrationPlan, type PlanSection, type SectionResult, type Walkthrough } from "./types";

export type PipelineEvent =
  | { type: "phase"; phase: "explaining" | "overview" }
  | { type: "section-start"; id: string }
  | { type: "section-part"; id: string; part: number; total: number }
  | { type: "section-revising"; id: string }
  | { type: "section-done"; result: SectionResult }
  | { type: "section-failed"; id: string; message: string }
  | { type: "retry"; label: string; waitMs: number; reason: LlmErrorKind }
  | { type: "transport"; transport: Transport };

export type RunInput = {
  ingest: IngestResult;
  plan: NarrationPlan;
  settings: LlmSettings;
  options: NarrationOptions;
  /** Sections finished by an earlier attempt. */
  done?: Record<string, SectionResult>;
  signal: AbortSignal;
  onEvent: (e: PipelineEvent) => void;
  session?: Session;
  /** Set false to stop after the per-file sections (no overview or closing). */
  includeOverview?: boolean;
};

export type RunOutcome =
  | { status: "complete"; walkthrough: Walkthrough }
  | { status: "sections"; sections: SectionResult[] }
  | { status: "failed"; error: LlmError; failed: string[] };

const MAX_TOKENS = 4096;
/** Consecutive sections that may fail on transient errors before we stop and let the user resume. */
const MAX_CONSECUTIVE_FAILURES = 3;

export async function runWalkthrough(input: RunInput): Promise<RunOutcome> {
  const { ingest, plan, settings, options, onEvent } = input;
  const ctx = buildContext(ingest, plan, options.length);
  const session = input.session ?? newSession();
  const results: Record<string, SectionResult> = { ...input.done };

  // Our own controller, so a fatal error can stop every request in flight.
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  input.signal.addEventListener("abort", onOuterAbort, { once: true });
  const signal = controller.signal;

  let lastTransport = session.transport;
  const call = async (messages: ChatMessage[], label: string, temperature = 0.6) => {
    const result = await withRetries(() => chat(settings, session, messages, { maxTokens: MAX_TOKENS, temperature, signal }), {
      signal,
      onRetry: ({ waitMs, error }) => onEvent({ type: "retry", label, waitMs, reason: error.kind }),
    });
    if (session.transport !== lastTransport) {
      lastTransport = session.transport;
      onEvent({ type: "transport", transport: session.transport });
    }
    return { text: result.text, truncated: result.truncated };
  };

  try {
    onEvent({ type: "phase", phase: "explaining" });
    const order = new Map(plan.sections.map((sec, i) => [sec.id, i]));
    const draftQueue = plan.sections.filter((sec) => !results[sec.id]);
    // Drafted parts waiting for their second look, in tour order.
    const reviseQueue: PlanSection[] = [];
    const drafts = new Map<string, Draft>();
    const failedIds = new Set<string>();
    const failed: string[] = [];
    let fatal: LlmError | null = null;
    let consecutiveFailures = 0;
    let lastTransientError: LlmError | null = null;
    const revise = options.revise !== false;

    // Workers that run out of ready work wait here until something finishes.
    let waiters: (() => void)[] = [];
    const notify = () => {
      const w = waiters;
      waiters = [];
      w.forEach((resolve) => resolve());
    };
    const nextChange = () => new Promise<void>((resolve) => waiters.push(resolve));
    signal.addEventListener("abort", notify, { once: true });

    /** What the listener will have heard before a part: final parts where they exist, drafts otherwise. */
    const earlierFor = (index: number) => {
      const map = new Map<string, SectionResult>();
      for (const sec of plan.sections.slice(0, index)) {
        const r = results[sec.id] ?? drafts.get(sec.id)?.result;
        if (r) map.set(sec.id, r);
      }
      return map;
    };
    // A part is revised once everything before it has at least a draft.
    const reviseReady = (sec: PlanSection) =>
      plan.sections.slice(0, order.get(sec.id)!).every((p) => results[p.id] || drafts.has(p.id) || failedIds.has(p.id));

    const onError = (sec: PlanSection, err: unknown): boolean => {
      const e = err instanceof LlmError ? err : new LlmError("server", err instanceof Error ? err.message : String(err));
      if (isFatal(e)) {
        fatal ??= e;
        controller.abort();
        return false;
      }
      // Cancelled because the run stopped: not this section's fault.
      if (signal.aborted) return false;
      failed.push(sec.id);
      failedIds.add(sec.id);
      onEvent({ type: "section-failed", id: sec.id, message: e.message });
      lastTransientError = e;
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        fatal ??= e;
        controller.abort();
        return false;
      }
      return true;
    };

    const finish = (result: SectionResult) => {
      results[result.id] = result;
      consecutiveFailures = 0;
      onEvent({ type: "section-done", result });
    };

    const draftOne = async (section: PlanSection) => {
      onEvent({ type: "section-start", id: section.id });
      try {
        const earlier = earlierFor(order.get(section.id)!);
        const draft =
          section.kind === "file" ? await explainFile(ctx, section, call, onEvent, earlier) : await explainGroup(ctx, section, call, earlier);
        if (!revise) return finish(draft.result);
        drafts.set(section.id, draft);
        reviseQueue.push(section);
        reviseQueue.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
        consecutiveFailures = 0;
      } catch (err) {
        return onError(section, err);
      } finally {
        notify();
      }
    };

    const reviseOne = async (section: PlanSection) => {
      const draft = drafts.get(section.id)!;
      onEvent({ type: "section-revising", id: section.id });
      try {
        const result = await reviseDraft(ctx, section, draft, earlierFor(order.get(section.id)!), call);
        finish(result);
      } catch (err) {
        const e = err instanceof LlmError ? err : null;
        if (e && (isFatal(e) || e.kind === "aborted" || signal.aborted)) return onError(section, err);
        // A second look that fails still leaves a good first draft.
        finish(draft.result);
      } finally {
        drafts.delete(section.id);
        notify();
      }
    };

    const worker = async () => {
      while (!fatal && !signal.aborted) {
        const ready = reviseQueue.findIndex(reviseReady);
        if (ready !== -1) {
          const [section] = reviseQueue.splice(ready, 1);
          if ((await reviseOne(section)) === false) return;
          continue;
        }
        if (draftQueue.length) {
          if ((await draftOne(draftQueue.shift()!)) === false) return;
          continue;
        }
        if (!reviseQueue.length) return;
        await nextChange();
      }
    };

    const workers = Math.max(1, Math.min(options.concurrency, draftQueue.length || 1));
    await Promise.all(Array.from({ length: workers }, worker));
    notify();

    if (input.signal.aborted) return { status: "failed", error: new LlmError("aborted", "Stopped."), failed };
    if (fatal) {
      const pending = plan.sections.filter((s) => !results[s.id]).map((s) => s.id);
      return { status: "failed", error: fatal, failed: pending };
    }

    const ordered = plan.sections.map((s) => results[s.id]).filter((r): r is SectionResult => Boolean(r));
    if (ordered.length === 0 || ordered.length < plan.sections.length / 2) {
      const error: LlmError =
        lastTransientError ?? new LlmError("server", "Most of the files couldn't be explained. Try again in a moment.");
      return { status: "failed", error, failed };
    }

    if (input.includeOverview === false) return { status: "sections", sections: ordered };

    onEvent({ type: "phase", phase: "overview" });
    const prose = (r: Reply) => (r.truncated ? endAtSentence(cleanProse(r.text)) : cleanProse(r.text));
    // The closing builds on the introduction, so it's written second.
    const overviewReply = await call(overviewMessages(ctx, ordered), "the overview", 0.5);
    const overview = prose(overviewReply);
    const parsedOverview = parseSectionReply(overviewReply.text);
    const name = parsedOverview.name;
    applyChapterNames(ordered, parsedOverview.chapters, parsedOverview.bridges);
    const closingReply = await call(closingMessages(ctx, ordered, overview), "the closing guide", 0.5);

    const walkthrough: Walkthrough = {
      repo: ingest.repo,
      name: name ?? undefined,
      model: settings.model,
      createdAt: new Date().toISOString(),
      title: `A guided tour of ${name ?? ingest.repo.repo}`,
      overview,
      closing: prose(closingReply),
      sections: ordered,
      missing: plan.sections.filter((s) => !results[s.id]).map((s) => ({ id: s.id, label: sectionLabel(s) })),
    };
    return { status: "complete", walkthrough };
  } catch (err) {
    if (input.signal.aborted) return { status: "failed", error: new LlmError("aborted", "Stopped."), failed: [] };
    const e = err instanceof LlmError ? err : new LlmError("server", err instanceof Error ? err.message : String(err));
    return { status: "failed", error: e, failed: [] };
  } finally {
    input.signal.removeEventListener("abort", onOuterAbort);
  }
}

type Reply = { text: string; truncated: boolean };

/** A part's first version, with what's needed to revise it. */
export type Draft = {
  result: SectionResult;
  /** The model's reply, trailers included. */
  reply: string;
  /** The single request that produced it; absent for long files written in pieces. */
  messages?: ChatMessage[];
};
type Call = (messages: ChatMessage[], label: string, temperature?: number) => Promise<Reply>;

/** A reply cut off at the token limit ends mid-sentence; drop the unfinished tail. */
export function endAtSentence(text: string): string {
  const trimmed = text.trim();
  if (/[.!?…]["”')]?$/.test(trimmed)) return trimmed;
  const cut = Math.max(trimmed.lastIndexOf(". "), trimmed.lastIndexOf("! "), trimmed.lastIndexOf("? "), trimmed.lastIndexOf(".\n"));
  return cut > trimmed.length * 0.5 ? trimmed.slice(0, cut + 1) : trimmed;
}

/** Strips any title/summary lines a model adds to free-form prose. */
function cleanProse(raw: string): string {
  const parsed = parseSectionReply(raw);
  return parsed.body || normaliseParagraphs(toSpeakable(raw));
}

async function explainFile(
  ctx: PromptContext,
  section: FileSection,
  call: Call,
  onEvent: (e: PipelineEvent) => void,
  earlierResults: Map<string, SectionResult> = new Map(),
): Promise<Draft> {
  const bodies: string[] = [];
  const summaries: string[] = [];
  const changes: string[] = [];
  const terms = new Set<string>();
  const notes = { recipes: [] as string[], bugs: [] as string[], explained: [] as string[], facts: [] as string[] };
  let lastMessages: ChatMessage[] | undefined;
  let lastReply = "";
  let title: string | null = null;
  let chunks = section.chunks;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunks.length > 1) onEvent({ type: "section-part", id: section.id, part: i + 1, total: chunks.length });
    const earlier = summaries.map((s, n) => `Part ${n + 1}: ${s}`);
    if (bodies.length) earlier.push(`The previous part ended with: "${lastParagraph(bodies[bodies.length - 1])}"`);
    let reply: Reply;
    const messages = fileMessages(ctx, section, chunk, earlier, earlierResults);
    try {
      reply = await call(messages, section.path);
    } catch (err) {
      // Too long for this model's context window: split this part in two and carry on.
      const halves = err instanceof LlmError && err.kind === "context" && chunk.text.length > 4000 && chunks.length < 24 ? halve(chunk) : null;
      if (halves) {
        chunks = [...chunks.slice(0, i), ...halves, ...chunks.slice(i + 1)].map((c, index, all) => ({ ...c, index, total: all.length }));
        i--;
        continue;
      }
      // A stop or a run-ending error isn't this file's fault: don't save half of it as finished.
      if ((err instanceof LlmError && (isFatal(err) || err.kind === "aborted")) || (err instanceof Error && err.name === "AbortError")) throw err;
      // Otherwise keep what earlier parts of this file already said rather than losing it all.
      if (bodies.length) break;
      throw err;
    }
    const parsed = parseSectionReply(reply.text);
    if (!parsed.body) throw new LlmError("empty", "The model's answer had no narration in it.");
    if (reply.truncated) parsed.body = endAtSentence(parsed.body);
    title ??= parsed.title;
    bodies.push(parsed.body);
    summaries.push(parsed.summary ?? firstSentences(parsed.body));
    if (parsed.changes) changes.push(parsed.changes);
    parsed.terms.forEach((t) => terms.add(t));
    notes.recipes.push(...parsed.recipes);
    notes.bugs.push(...parsed.bugs);
    notes.explained.push(...parsed.explained);
    notes.facts.push(...parsed.facts);
    lastMessages = messages;
    lastReply = reply.text;
  }

  const result: SectionResult = {
    id: section.id,
    title: sentenceCase(title ?? fallbackTitle(section.path)),
    body: bodies.join("\n\n"),
    summary: summaries.length > 1 ? summaries.map((s) => firstSentences(s, 1)).join(" ") : summaries[0],
    paths: [section.path],
    chapter: section.chapter,
    chapterTitle: chapterTitle(section.chapter, ctx.plan.chapterTitles),
    changes: changes.join(" ") || undefined,
    terms: [...terms],
    ...notes,
  };
  // One request: revise inside its own conversation. Several: revise the joined text.
  return bodies.length === 1 && chunks.length === 1
    ? { result, reply: lastReply, messages: lastMessages }
    : { result, reply: formatReply(result) };
}

async function explainGroup(
  ctx: PromptContext,
  section: GroupSection,
  call: Call,
  earlier: Map<string, SectionResult> = new Map(),
): Promise<Draft> {
  let reply: Reply;
  let messages = groupMessages(ctx, section, earlier);
  try {
    reply = await call(messages, section.title);
  } catch (err) {
    if (!(err instanceof LlmError && err.kind === "context")) throw err;
    // Show less of each file and try once more.
    const smaller = { ...ctx, budget: { ...ctx.budget, groupChars: Math.floor(ctx.budget.groupChars / 3) } };
    messages = groupMessages(smaller, section, earlier);
    reply = await call(messages, section.title);
  }
  const parsed = parseSectionReply(reply.text);
  if (!parsed.body) throw new LlmError("empty", "The model's answer had no narration in it.");
  if (reply.truncated) parsed.body = endAtSentence(parsed.body);
  return { result: toResult(ctx, section, parsed, section.title), reply: reply.text, messages };
}

function toResult(ctx: PromptContext, section: PlanSection, parsed: ParsedSection, fallback: string): SectionResult {
  return {
    id: section.id,
    title: sentenceCase(parsed.title ?? fallback),
    body: parsed.body,
    summary: parsed.summary ?? firstSentences(parsed.body),
    paths: sectionPaths(section),
    chapter: section.chapter,
    chapterTitle: chapterTitle(section.chapter, ctx.plan.chapterTitles),
    changes: parsed.changes ?? undefined,
    terms: parsed.terms,
    recipes: parsed.recipes,
    bugs: parsed.bugs,
    explained: parsed.explained,
    facts: parsed.facts,
  };
}

/** A result written back out in the reply format, for revising a long file's joined draft. */
function formatReply(r: SectionResult): string {
  const list = (xs?: string[]) => (xs?.length ? xs.join("\n") : "none");
  return [
    `TITLE: ${r.title}`,
    r.body,
    `RECIPE: ${list(r.recipes)}`,
    `BUGS: ${list(r.bugs)}`,
    `EXPLAINED: ${list(r.explained)}`,
    `FACTS: ${list(r.facts)}`,
    `TERMS: ${r.terms?.length ? r.terms.join(", ") : "none"}`,
    `SUMMARY: ${r.summary}`,
  ].join("\n\n");
}

/** The earlier part that shares the most rare names with this one, if it shares enough. */
function siblingOf(ctx: PromptContext, section: PlanSection, earlier: Map<string, SectionResult>): SectionResult | undefined {
  const mine = new Set(sectionPaths(section).flatMap((p) => [...(ctx.links.names.get(p) ?? [])]));
  if (mine.size < 3) return undefined;
  let best: SectionResult | undefined;
  let bestShared = 2;
  for (const r of earlier.values()) {
    const theirs = new Set(r.paths.flatMap((p) => [...(ctx.links.names.get(p) ?? [])]));
    const shared = [...mine].filter((n) => theirs.has(n)).length;
    if (shared > bestShared && shared >= 0.4 * Math.min(mine.size, theirs.size)) {
      best = r;
      bestShared = shared;
    }
  }
  return best;
}

/**
 * The second look: with everything before it now written, cut repeats, settle
 * hedges and check recipes. If the revision comes back empty, the draft stands.
 */
async function reviseDraft(
  ctx: PromptContext,
  section: PlanSection,
  draft: Draft,
  earlier: Map<string, SectionResult>,
  call: Call,
): Promise<SectionResult> {
  const index = ctx.plan.sections.findIndex((s) => s.id === section.id);
  const ordered = ctx.plan.sections.slice(0, index).map((s, n) => ({ n: n + 1, r: earlier.get(s.id) }));
  const known: EarlierPart[] = ordered.filter((x) => x.r).map((x) => ({ number: x.n, title: x.r!.title, body: x.r!.body }));
  const previous = earlier.get(ctx.plan.sections[index - 1]?.id ?? "");
  const explainedTerms = [...new Set([...ctx.terms, ...[...earlier.values()].flatMap((r) => r.terms ?? [])])];
  const flags = lintPart(draft.result.body, known, explainedTerms);
  const messages = revisionMessages(ctx, section, {
    draftMessages: draft.messages,
    draftReply: draft.reply,
    earlier,
    previous,
    sibling: siblingOf(ctx, section, earlier),
    flags,
  });
  const reply = await call(messages, `${sectionLabel(section)} (second look)`, 0.4);
  const parsed = parseSectionReply(reply.text);
  // A revision that lost most of the part is worse than the draft.
  if (!parsed.body || parsed.body.split(/\s+/).length < draft.result.body.split(/\s+/).length * 0.5) return draft.result;
  if (reply.truncated) parsed.body = endAtSentence(parsed.body);
  const revised = toResult(ctx, section, parsed, draft.result.title);
  return {
    ...revised,
    title: parsed.title ? revised.title : draft.result.title,
    summary: parsed.summary ?? draft.result.summary,
    terms: parsed.terms.length ? parsed.terms : draft.result.terms,
    recipes: parsed.recipes.length ? parsed.recipes : draft.result.recipes,
    bugs: parsed.bugs.length ? parsed.bugs : draft.result.bugs,
    explained: parsed.explained.length ? parsed.explained : draft.result.explained,
    facts: parsed.facts.length ? parsed.facts : draft.result.facts,
  };
}

/** Chapter titles and bridges from the introduction, onto the parts that open each chapter. */
export function applyChapterNames(results: SectionResult[], titles: Record<number, string>, bridges: Record<number, string>) {
  chapterRuns(results).forEach((run, i) => {
    const title = titles[i + 1];
    for (const r of run.parts) if (title) r.chapterTitle = title;
    if (i > 0 && bridges[i + 1]) run.parts[0].bridge = bridges[i + 1];
  });
}

/** Splits a part in two for a model with a small context window; null if it can't be split. */
export function halve(chunk: Chunk): Chunk[] | null {
  const lines = chunk.text.split("\n");
  if (lines.length >= 2) {
    const mid = Math.ceil(lines.length / 2);
    return [
      { ...chunk, endLine: chunk.startLine + mid - 1, text: lines.slice(0, mid).join("\n") },
      { ...chunk, startLine: chunk.startLine + mid, text: lines.slice(mid).join("\n") },
    ];
  }
  // One enormous line (an inlined image, a minified blob): keep its start, which is all a narrator needs.
  if (chunk.text.length > 8000) return [{ ...chunk, text: `${chunk.text.slice(0, 4000)}\n[… the rest of this very long line is omitted]` }];
  return null;
}

function lastParagraph(text: string) {
  const paras = text.split(/\n{2,}/);
  const last = paras[paras.length - 1] ?? "";
  return last.length > 600 ? `…${last.slice(-600)}` : last;
}

/**
 * "The Article Editor Form" → "The article editor form", leaving names that
 * are clearly proper nouns or acronyms (React, API, the Editor component) alone
 * when the title is already mostly lowercase.
 */
export function sentenceCase(title: string): string {
  const words = title.trim().split(/\s+/);
  // Title Case capitalises every longer word; a title with any lowercase
  // longer word is already sentence case with proper nouns, so leave it.
  const longer = words.slice(1).filter((w) => w.replace(/[^A-Za-z]/g, "").length > 3);
  const titleCase = longer.length >= 2 && longer.every((w) => /^[A-Z]/.test(w));
  if (!titleCase) return title.trim();
  return [words[0], ...words.slice(1).map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))].join(" ");
}

/** "app/(chat)/api/chat/route.ts" → "The route file in the chat folder". */
export function fallbackTitle(path: string): string {
  const parts = path.split("/");
  const file = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  const folder = [...parts.slice(0, -1)].reverse().find((p) => !/^[([]/.test(p));
  const human = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[-_.]+/g, " ")
      .trim()
      .toLowerCase();
  return folder ? `The ${human(file)} file in ${human(folder)}` : `The ${human(file)} file`;
}

export function sectionsFor(plan: NarrationPlan, ids: string[]): PlanSection[] {
  const set = new Set(ids);
  return plan.sections.filter((s) => set.has(s.id));
}
