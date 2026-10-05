/**
 * Runs a whole walkthrough in the browser: explain every planned section with
 * a few requests in flight, then write the overview and the closing guide
 * from those explanations. Finished sections are reported as they land, so a
 * failed run can resume without paying for them twice.
 */
import type { IngestResult } from "@/lib/ingest/types";
import { chat, isFatal, LlmError, newSession, withRetries, type LlmErrorKind, type Session, type Transport } from "./llm";
import { sectionLabel, sectionPaths } from "./plan";
import { buildContext, closingMessages, fileMessages, groupMessages, overviewMessages, type ChatMessage, type PromptContext } from "./prompts";
import { firstSentences, normaliseParagraphs, parseSectionReply, toSpeakable } from "./speakable";
import { chapterTitle, type Chunk, type FileSection, type GroupSection, type LlmSettings, type NarrationOptions, type NarrationPlan, type PlanSection, type SectionResult, type Walkthrough } from "./types";

export type PipelineEvent =
  | { type: "phase"; phase: "explaining" | "overview" }
  | { type: "section-start"; id: string }
  | { type: "section-part"; id: string; part: number; total: number }
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
    const queue = plan.sections.filter((s) => !results[s.id]);
    const failed: string[] = [];
    let fatal: LlmError | null = null;
    let consecutiveFailures = 0;
    let lastTransientError: LlmError | null = null;

    const worker = async () => {
      while (queue.length && !fatal && !signal.aborted) {
        const section = queue.shift()!;
        onEvent({ type: "section-start", id: section.id });
        try {
          // Parts are written a few at a time; each sees whatever finished before it starts.
          const earlier = new Map(Object.entries(results));
          const result =
            section.kind === "file"
              ? await explainFile(ctx, section, call, onEvent, earlier)
              : await explainGroup(ctx, section, call, earlier);
          results[section.id] = result;
          consecutiveFailures = 0;
          onEvent({ type: "section-done", result });
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError("server", err instanceof Error ? err.message : String(err));
          if (isFatal(e)) {
            fatal ??= e;
            controller.abort();
            return;
          }
          // Cancelled because the run stopped: not this section's fault.
          if (signal.aborted) return;
          failed.push(section.id);
          onEvent({ type: "section-failed", id: section.id, message: e.message });
          lastTransientError = e;
          if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            fatal ??= e;
            controller.abort();
            return;
          }
        }
      }
    };

    const workers = Math.max(1, Math.min(options.concurrency, queue.length || 1));
    await Promise.all(Array.from({ length: workers }, worker));

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
    const name = parseSectionReply(overviewReply.text).name;
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
): Promise<SectionResult> {
  const bodies: string[] = [];
  const summaries: string[] = [];
  const changes: string[] = [];
  const terms = new Set<string>();
  let title: string | null = null;
  let chunks = section.chunks;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunks.length > 1) onEvent({ type: "section-part", id: section.id, part: i + 1, total: chunks.length });
    const earlier = summaries.map((s, n) => `Part ${n + 1}: ${s}`);
    if (bodies.length) earlier.push(`The previous part ended with: "${lastParagraph(bodies[bodies.length - 1])}"`);
    let reply: Reply;
    try {
      reply = await call(fileMessages(ctx, section, chunk, earlier, earlierResults), section.path);
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
  }

  return {
    id: section.id,
    title: sentenceCase(title ?? fallbackTitle(section.path)),
    body: bodies.join("\n\n"),
    summary: summaries.length > 1 ? summaries.map((s) => firstSentences(s, 1)).join(" ") : summaries[0],
    paths: [section.path],
    chapter: section.chapter,
    chapterTitle: chapterTitle(section.chapter, ctx.plan.chapterTitles),
    changes: changes.join(" ") || undefined,
    terms: [...terms],
  };
}

async function explainGroup(
  ctx: PromptContext,
  section: GroupSection,
  call: Call,
  earlier: Map<string, SectionResult> = new Map(),
): Promise<SectionResult> {
  let reply: Reply;
  try {
    reply = await call(groupMessages(ctx, section, earlier), section.title);
  } catch (err) {
    if (!(err instanceof LlmError && err.kind === "context")) throw err;
    // Show less of each file and try once more.
    const smaller = { ...ctx, budget: { ...ctx.budget, groupChars: Math.floor(ctx.budget.groupChars / 3) } };
    reply = await call(groupMessages(smaller, section, earlier), section.title);
  }
  const parsed = parseSectionReply(reply.text);
  if (!parsed.body) throw new LlmError("empty", "The model's answer had no narration in it.");
  if (reply.truncated) parsed.body = endAtSentence(parsed.body);
  return {
    id: section.id,
    title: sentenceCase(parsed.title ?? section.title),
    body: parsed.body,
    summary: parsed.summary ?? firstSentences(parsed.body),
    paths: sectionPaths(section),
    chapter: section.chapter,
    chapterTitle: chapterTitle(section.chapter, ctx.plan.chapterTitles),
    changes: parsed.changes ?? undefined,
    terms: parsed.terms,
  };
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
