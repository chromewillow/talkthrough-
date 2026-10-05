"use client";

import { ArrowRight, ArrowUp, History, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isResumable, toFriendly } from "@/lib/client/errors";
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
  const [needsKey, setNeedsKey] = useState(false);
  const [run, dispatch] = useReducer(runReducer, null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<{ key: string; session: Session } | null>(null);
  const [formError, setFormError] = useState<FriendlyError | null>(null);
  const [last, setLast] = useState<Walkthrough | null>(null);
  const [shownLast, setShownLast] = useState<Walkthrough | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  // Settings and the last walkthrough live in localStorage, which only exists in the browser.
  useEffect(() => {
    const stored = loadSettings();
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from storage once on mount */
    setSettings(stored);
    if (!stored.apiKey) setSettingsOpen(true);
    setLast(loadLast());
    /* eslint-enable react-hooks/set-state-in-effect */
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
      setSettingsOpen(true);
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
    setShownLast(null);
    if (!resume) dispatch({ type: "reset" });
    dispatch({ type: "start", url: target });

    try {
      const result = await ingest(target, controller.signal);
      const plan = buildPlan(result, DEFAULT_OPTIONS.length);
      const key = runKey(result, settings.model);
      dispatch({ type: "ingested", ingest: result, plan, key });

      // Reuse what an interrupted run of the same repo and model already finished.
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
      if (outcome.status === "failed") dispatch({ type: "failed", error: toFriendly(outcome.error) });
      else if (outcome.status === "complete") {
        dispatch({ type: "done", walkthrough: outcome.walkthrough });
        saveLast(outcome.walkthrough);
        setLast(outcome.walkthrough);
        requestAnimationFrame(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      dispatch({ type: "failed", error: toFriendly(err) });
    }
  }

  function stop() {
    abortRef.current?.abort();
    dispatch({ type: "stopped" });
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
        <span className="font-serif text-[1.375rem] leading-none tracking-[-0.01em] text-soft-white">Talkthrough</span>
        <span className="label-caps">Code, narrated</span>
      </header>

      <section className="pt-16 pb-10 sm:pt-24 sm:pb-12">
        <h1 className="text-balance font-serif text-[2.75rem] leading-[1.02] tracking-[-0.015em] text-soft-white sm:text-[4rem]">
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
                    onClick={() => setUrl(`github.com/${ex}`)}
                    className="cursor-pointer font-mono text-[0.6875rem] text-periwinkle/80 underline-offset-4 transition-colors hover:text-soft-white hover:underline"
                  >
                    {ex}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>

        <SettingsPanel value={settings} onChange={updateSettings} open={settingsOpen} onOpenChange={setSettingsOpen} needsKey={needsKey} />

        {formError && (
          <p role="alert" className="text-[0.8125rem] leading-relaxed text-gold/90">
            <span className="text-gold">{formError.title}.</span> {formError.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {busy ? (
            <Button type="button" variant="outline" size="lg" onClick={stop} className="w-full sm:w-auto">
              <Square className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button type="submit" size="lg" className="w-full sm:w-auto">
              <ArrowRight />
              Generate walkthrough
            </Button>
          )}
        </div>
      </form>

      {!run && !shownLast && last && (
        <button
          type="button"
          onClick={() => setShownLast(last)}
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
        <div role="alert" className="panel mt-6 border-l-2 border-l-destructive/50 p-5 sm:p-6">
          <p className="label-caps text-destructive/80">Couldn&apos;t finish</p>
          <p className="mt-2 font-serif text-2xl text-soft-white">{run.error.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{run.error.message}</p>
          {canResume && <ResumeButton onClick={() => void generate(true)} />}
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
              <p className="mt-2 font-serif text-[1.375rem] leading-tight text-soft-white">{step.title}</p>
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
          <span className="font-serif text-[0.9375rem] text-muted-foreground">Talkthrough</span> · bring your own model · your key stays in
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

function ResumeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" className="mt-4 sm:mt-0" onClick={onClick}>
      <RotateCcw className="size-4" />
      Resume
    </Button>
  );
}
