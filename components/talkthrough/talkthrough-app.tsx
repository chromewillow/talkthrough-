"use client";

import { ArrowRight, ArrowUp, History, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isResumable, resumeHint, toFriendly } from "@/lib/client/errors";
import { loadLast, saveLast } from "@/lib/client/history";
import { FriendlyError, ingest } from "@/lib/client/ingest";
import { runKey, runReducer } from "@/lib/client/run-state";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type StoredSettings } from "@/lib/client/settings";
import { newSession, normaliseBaseUrl, type Session } from "@/lib/narrate/llm";
import { runWalkthrough } from "@/lib/narrate/pipeline";
import { buildPlan } from "@/lib/narrate/plan";
import { DEFAULT_OPTIONS, type SectionResult, type Walkthrough } from "@/lib/narrate/types";
import { ProgressView } from "./progress-view";
import { ResultView } from "./result-view";
import { SettingsPanel } from "./settings-panel";

const EXAMPLES = ["vercel/ai-chatbot", "coderamp-labs/gitingest"];

const STEPS = [
  {
    title: "Paste a repository",
    body: "Any public GitHub link. Dependencies, build output, lockfiles and assets are skipped automatically.",
  },
  {
    title: "Every file, explained",
    body: "Your model walks through each file in plain English: what it does, why it's there, and where you'd change it.",
  },
  {
    title: "Press play",
    body: "Copy the script into ElevenLabs and listen while you walk, cook or commute.",
  },
];

export function TalkthroughApp() {
  const [url, setUrl] = useState("");
  const [settings, setSettings] = useState<StoredSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The automatic first open (no key saved yet) appears without animating.
  const [settingsAnimate, setSettingsAnimate] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [run, dispatch] = useReducer(runReducer, null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<{ key: string; session: Session } | null>(null);
  const [formError, setFormError] = useState<FriendlyError | null>(null);
  const [last, setLast] = useState<Walkthrough | null>(null);
  const [shownLast, setShownLast] = useState<Walkthrough | null>(null);
  // Stored settings aren't known until the browser has loaded them.
  const [ready, setReady] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // A finished walkthrough a retry would replace, kept so a failed retry can show it again.
  const priorRef = useRef<Walkthrough | null>(null);

  // Settings and the last walkthrough live in localStorage, which only exists in the browser.
  useEffect(() => {
    const stored = loadSettings();
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from storage once on mount */
    setSettings(stored);
    if (!stored.apiKey) setSettingsOpen(true);
    setLast(loadLast());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // A failure can land below the fold: bring it into view and give it focus.
  useEffect(() => {
    if (run?.phase !== "failed") return;
    const el = errorRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [run?.phase]);

  const openSettings = useCallback((open: boolean) => {
    setSettingsAnimate(true);
    setSettingsOpen(open);
  }, []);

  const updateSettings = useCallback((next: StoredSettings) => {
    setSettings(next);
    saveSettings(next);
    if (next.apiKey) setNeedsKey(false);
  }, []);

  const busy = run?.phase === "reading" || run?.phase === "explaining" || run?.phase === "overview";

  async function generate(resume = false) {
    setFormError(null);
    const target = resume && run ? run.url : url;
    if (!target.trim()) {
      setFormError(new FriendlyError("Paste a repository first", "Any public GitHub link works, like github.com/vercel/ai-chatbot."));
      urlRef.current?.focus();
      return;
    }
    if (!settings.apiKey.trim() || !settings.model.trim() || !normaliseBaseUrl(settings.baseUrl)) {
      setNeedsKey(true);
      openSettings(true);
      setFormError(
        new FriendlyError(
          "Add your model details first",
          "Talkthrough uses your own API key to write the walkthrough. Add a key, a model and a base URL under Model & key.",
        ),
      );
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    priorRef.current = resume ? (run?.phase === "done" ? (run.walkthrough ?? null) : shownLast) : null;
    setShownLast(null);
    if (!resume) dispatch({ type: "reset" });
    dispatch({ type: "start", url: target });
    if (resume) requestAnimationFrame(() => document.getElementById("progress-title")?.focus());

    try {
      const result = await ingest(target, controller.signal);
      const plan = buildPlan(result, DEFAULT_OPTIONS.length);
      const key = runKey(result);
      dispatch({ type: "ingested", ingest: result, plan, key });

      // Reuse what an interrupted run of the same repo already finished, even with a different model.
      const done: Record<string, SectionResult> = resume && run?.key === key ? { ...run.results } : {};
      if (sessionRef.current?.key !== `${settings.baseUrl}|${settings.model}`) {
        sessionRef.current = { key: `${settings.baseUrl}|${settings.model}`, session: newSession() };
      }

      const outcome = await runWalkthrough({
        ingest: result,
        plan,
        settings: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
        options: { ...DEFAULT_OPTIONS, concurrency: settings.concurrency },
        done,
        signal: controller.signal,
        session: sessionRef.current.session,
        onEvent: (event) => dispatch({ type: "event", event }),
      });

      if (controller.signal.aborted) return;
      if (outcome.status === "failed") fail(outcome.error);
      else if (outcome.status === "complete") {
        priorRef.current = null;
        dispatch({ type: "done", walkthrough: outcome.walkthrough });
        saveLast(outcome.walkthrough);
        setLast(outcome.walkthrough);
        requestAnimationFrame(() => {
          document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
          document.getElementById("result-title")?.focus({ preventScroll: true });
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      fail(err);
    }
  }

  function fail(err: unknown) {
    const error = toFriendly(err);
    dispatch({ type: "failed", error });
    // The walkthrough a failed retry was meant to complete stays on screen.
    if (priorRef.current) setShownLast(priorRef.current);
    // Problems fixed under Model & key: open it, so the fix is one step away.
    if (error.code === "auth" || error.code === "credits" || error.code === "model") openSettings(true);
  }

  function stop() {
    abortRef.current?.abort();
    dispatch({ type: "stopped" });
    if (priorRef.current) setShownLast(priorRef.current);
  }

  function openLast(w: Walkthrough) {
    setShownLast(w);
    requestAnimationFrame(() => document.getElementById("result-title")?.focus());
  }

  function startOver() {
    abortRef.current?.abort();
    dispatch({ type: "reset" });
    setShownLast(null);
    setUrl("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => urlRef.current?.focus(), 400);
  }

  const canResume =
    !!run && (run.phase === "stopped" || (run.phase === "failed" && isResumable(run.error?.code))) && !!run.plan;
  const finished = run?.phase === "done" ? run.walkthrough : shownLast;

  return (
    <main className="mx-auto flex w-full max-w-[44rem] flex-col px-4 pt-8 pb-28 sm:px-8 sm:pt-14">
      <header className="flex items-center justify-between">
        <span className="font-display text-[1.25rem] leading-none font-medium tracking-[-0.02em] text-soft-white">Talkthrough</span>
        <span className="label-caps">Code, narrated</span>
      </header>

      <section className="pt-16 pb-10 sm:pt-24 sm:pb-12">
        <h1 className="text-balance font-display text-[2.5rem] leading-[1.06] font-medium tracking-[-0.03em] text-soft-white sm:text-[3.75rem]">
          Hear what your code <em className="text-periwinkle">is actually doing.</em>
        </h1>
        <p className="mt-6 max-w-[34rem] text-pretty text-[1.0625rem] leading-relaxed text-muted-foreground">
          Paste a GitHub repository. Talkthrough reads every meaningful file and writes a calm, plain-English
          walkthrough — made to be listened to.
        </p>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void generate(false);
        }}
        className="panel space-y-5 p-5 sm:p-7"
      >
        <div>
          <Label htmlFor="repo-url">Repository</Label>
          <Input
            ref={urlRef}
            id="repo-url"
            name="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-3 h-12 rounded-full px-5 text-base"
            disabled={busy}
          />
          {!busy && !url && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-[0.75rem] text-faint">
              <span>Try</span>
              {EXAMPLES.map((ex, i) => (
                <span key={ex} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden>·</span>}
                  <button
                    type="button"
                    onClick={() => {
                      setUrl(`github.com/${ex}`);
                      urlRef.current?.focus();
                    }}
                    className="cursor-pointer font-mono text-[0.6875rem] text-periwinkle/80 underline-offset-4 transition-colors hover:text-soft-white hover:underline"
                  >
                    {ex}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>

        <SettingsPanel
          value={settings}
          onChange={updateSettings}
          open={settingsOpen}
          onOpenChange={openSettings}
          needsKey={needsKey}
          ready={ready}
          animate={settingsAnimate}
        />

        {formError && (
          <p role="alert" className="text-[0.8125rem] leading-relaxed text-gold/90">
            <span className="text-gold">{formError.title}.</span> {formError.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {/* Separate keys: React must not turn the Stop button into the submit button mid-click. */}
          {busy ? (
            <Button
              key="stop"
              type="button"
              variant="outline"
              size="lg"
              onClick={(e) => {
                e.preventDefault();
                stop();
              }}
              className="w-full sm:w-auto"
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button key="generate" type="submit" size="lg" className="w-full sm:w-auto">
              <ArrowRight />
              Generate walkthrough
            </Button>
          )}
        </div>
      </form>

      {(!run || run.phase === "failed" || run.phase === "stopped") && !shownLast && last && (
        <button
          type="button"
          onClick={() => openLast(last)}
          className="group mt-5 flex cursor-pointer items-center gap-3 self-start rounded-full px-1 text-left text-[0.8125rem] text-faint transition-colors hover:text-soft-white"
        >
          <History className="size-4 text-periwinkle/70" />
          <span>
            Open your last walkthrough · <span className="text-muted-foreground group-hover:text-soft-white">{last.repo.owner}/{last.repo.repo}</span>
          </span>
        </button>
      )}

      {run && run.phase !== "done" && <ProgressView run={run} className="mt-6" />}

      {run?.phase === "failed" && run.error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="panel mt-6 border-l-2 border-l-destructive/50 p-5 outline-none sm:p-6">
          <p className="label-caps text-destructive/80">Couldn&apos;t finish</p>
          <p className="mt-2 font-display text-[1.375rem] font-medium tracking-[-0.01em] text-soft-white">{run.error.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{run.error.message}</p>
          {canResume && resumeHint(run.error.code) && <p className="mt-3 text-[0.8125rem] text-faint">{resumeHint(run.error.code)}</p>}
          {canResume && <ResumeButton className="mt-5" onClick={() => void generate(true)} />}
        </div>
      )}
      {run?.phase === "stopped" && canResume && (
        <div className="panel mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-sm text-muted-foreground">Stopped. Finished parts are kept if you resume.</p>
          <ResumeButton onClick={() => void generate(true)} />
        </div>
      )}

      {!run && !finished && (
        <ol className="mt-16 grid gap-8 border-t border-border pt-10 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="font-mono text-[0.6875rem] text-gold/70">0{i + 1}</span>
              <p className="mt-2 font-display text-[1.1875rem] leading-tight font-medium tracking-[-0.01em] text-soft-white">{step.title}</p>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      )}

      {finished && (
        <div id="result" className="scroll-mt-4">
          <ResultView
            walkthrough={finished}
            onRetryMissing={run?.phase === "done" && finished.missing.length ? () => void generate(true) : undefined}
            className="mt-6"
          />
          <div className="mt-8 flex justify-center">
            <Button variant="ghost" onClick={startOver}>
              <ArrowUp className="size-4" />
              Start another walkthrough
            </Button>
          </div>
        </div>
      )}

      <footer className="mt-24 flex flex-col gap-2 border-t border-border pt-6 text-[0.75rem] text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="font-display font-medium text-muted-foreground">Talkthrough</span> · bring your own model · your key stays in
          your browser
        </span>
        <a
          href="https://github.com/chromewillow/talkthrough-"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 transition-colors hover:text-soft-white hover:underline"
        >
          Source on GitHub
        </a>
      </footer>
    </main>
  );
}

function ResumeButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button type="button" variant="outline" className={className} onClick={onClick}>
      <RotateCcw className="size-4" />
      Resume
    </Button>
  );
}
