import type { IngestResult } from "@/lib/ingest/types";
import type { PipelineEvent } from "@/lib/narrate/pipeline";
import type { NarrationPlan, SectionResult, Walkthrough } from "@/lib/narrate/types";
import type { FriendlyError } from "./ingest";

export type RunPhase = "reading" | "explaining" | "overview" | "done" | "failed" | "stopped";

export type RunState = {
  /** Identity for resuming: same repo, ref and folder. Finished parts survive a model change. */
  key: string;
  url: string;
  phase: RunPhase;
  ingest?: IngestResult;
  plan?: NarrationPlan;
  results: Record<string, SectionResult>;
  active: Record<string, { part?: number; total?: number; revising?: boolean }>;
  failed: Record<string, string>;
  notice?: string;
  relay: boolean;
  error?: FriendlyError;
  walkthrough?: Walkthrough;
  /** The section that finished most recently, for the live preview. */
  latest?: string;
};

export type RunAction =
  | { type: "start"; url: string }
  | { type: "ingested"; ingest: IngestResult; plan: NarrationPlan; key: string }
  | { type: "event"; event: PipelineEvent }
  | { type: "notice"; text?: string }
  | { type: "done"; walkthrough: Walkthrough }
  | { type: "failed"; error: FriendlyError }
  | { type: "stopped" }
  | { type: "reset" };

export const initialRun: RunState | null = null;

export function runReducer(state: RunState | null, action: RunAction): RunState | null {
  switch (action.type) {
    case "reset":
      return null;
    case "start": {
      // Keep finished sections around so a resume of the same repo can reuse them.
      return {
        key: state?.key ?? "",
        url: action.url,
        phase: "reading",
        ingest: state?.ingest,
        plan: state?.plan,
        results: state?.results ?? {},
        active: {},
        failed: {},
        relay: state?.relay ?? false,
      };
    }
    case "ingested": {
      if (!state) return state;
      const keep = state.key === action.key;
      return {
        ...state,
        key: action.key,
        ingest: action.ingest,
        plan: action.plan,
        results: keep ? pick(state.results, action.plan.sections.map((s) => s.id)) : {},
        phase: "explaining",
        walkthrough: undefined,
        error: undefined,
        latest: undefined,
      };
    }
    case "event": {
      if (!state) return state;
      const e = action.event;
      switch (e.type) {
        case "phase":
          return { ...state, phase: e.phase, notice: undefined };
        case "section-start": {
          const failed = { ...state.failed };
          delete failed[e.id];
          return { ...state, active: { ...state.active, [e.id]: {} }, failed };
        }
        case "section-part":
          return { ...state, active: { ...state.active, [e.id]: { part: e.part, total: e.total } } };
        case "section-revising":
          return { ...state, active: { ...state.active, [e.id]: { revising: true } } };
        case "section-done": {
          const active = { ...state.active };
          delete active[e.result.id];
          return {
            ...state,
            active,
            results: { ...state.results, [e.result.id]: e.result },
            latest: e.result.id,
            notice: undefined,
          };
        }
        case "section-failed": {
          const active = { ...state.active };
          delete active[e.id];
          return { ...state, active, failed: { ...state.failed, [e.id]: e.message } };
        }
        case "retry": {
          const secs = Math.max(1, Math.round(e.waitMs / 1000));
          const why =
            e.reason === "rate_limit"
              ? "The provider asked us to slow down"
              : e.reason === "empty"
                ? "The model sent back an empty answer"
                : "The provider had a hiccup";
          return { ...state, notice: `${why} while working on ${e.label}. Trying again in ${secs} second${secs === 1 ? "" : "s"}.` };
        }
        case "transport":
          return { ...state, relay: e.transport === "relay" };
      }
      return state;
    }
    case "notice":
      return state ? { ...state, notice: action.text } : state;
    case "done":
      return state ? { ...state, phase: "done", active: {}, walkthrough: action.walkthrough, notice: undefined } : state;
    case "failed":
      return state ? { ...state, phase: "failed", active: {}, error: action.error, notice: undefined } : state;
    case "stopped":
      return state ? { ...state, phase: "stopped", active: {}, notice: undefined } : state;
  }
}

function pick<T>(obj: Record<string, T>, keys: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of keys) if (obj[k]) out[k] = obj[k];
  return out;
}

export function runKey(ingest: IngestResult) {
  const { owner, repo, ref, subpath } = ingest.repo;
  return [owner, repo, ref, subpath].join("|").toLowerCase();
}
