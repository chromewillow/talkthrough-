"use client";

import { ArrowRight, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isResumable, toFriendly } from "@/lib/client/errors";
import { FriendlyError, ingest } from "@/lib/client/ingest";
import { runKey, runReducer, type RunState } from "@/lib/client/run-state";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type StoredSettings } from "@/lib/client/settings";
import { newSession, normaliseBaseUrl, type Session } from "@/lib/narrate/llm";
import { runWalkthrough } from "@/lib/narrate/pipeline";
import { buildPlan } from "@/lib/narrate/plan";
import { DEFAULT_OPTIONS, type SectionResult } from "@/lib/narrate/types";
import { ProgressView } from "./progress-view";
import { SettingsPanel } from "./settings-panel";

export function TalkthroughApp() {
  const [url, setUrl] = useState("");
  const [settings, setSettings] = useState<StoredSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [run, dispatch] = useReducer(runReducer, null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<{ key: string; session: Session } | null>(null);
  const [formError, setFormError] = useState<FriendlyError | null>(null);

  // Settings live in localStorage, which only exists in the browser.
  useEffect(() => {
    const stored = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage once on mount
    setSettings(stored);
    if (!stored.apiKey) setSettingsOpen(true);
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
    if (!target.trim()) return;
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
        includeOverview: false,
        onEvent: (event) => dispatch({ type: "event", event }),
      });

      if (controller.signal.aborted) return;
      if (outcome.status === "failed") dispatch({ type: "failed", error: toFriendly(outcome.error) });
      else if (outcome.status === "sections") {
        dispatch({
          type: "done",
          walkthrough: {
            repo: result.repo,
            model: settings.model,
            createdAt: new Date().toISOString(),
            title: `A guided tour of ${result.repo.repo}`,
            overview: "",
            closing: "",
            sections: outcome.sections,
            missing: [],
          },
        });
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

  const canResume =
    !!run && (run.phase === "stopped" || (run.phase === "failed" && isResumable(run.error?.code))) && !!run.plan;

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
            required
          />
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
            <Button type="submit" size="lg" disabled={!url.trim()} className="w-full sm:w-auto">
              <ArrowRight />
              Generate walkthrough
            </Button>
          )}
        </div>
      </form>

      {run && <ProgressView run={run} className="mt-6" />}

      {run?.phase === "failed" && run.error && (
        <div role="alert" className="panel mt-6 p-5 sm:p-6">
          <p className="font-serif text-xl text-soft-white">{run.error.title}</p>
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

      {run && <SectionsPreview run={run} />}
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

/** The explanations written so far, in listening order. */
function SectionsPreview({ run }: { run: RunState }) {
  if (!run.plan) return null;
  const sections = run.plan.sections.map((s) => run.results[s.id]).filter(Boolean);
  if (!sections.length) return null;
  return (
    <section className="panel mt-6 p-5 sm:p-8">
      <p className="label-caps">The tour so far</p>
      <div className="mt-6 space-y-10">
        {sections.map((s, i) => (
          <article key={s.id}>
            <h3 className="font-serif text-2xl text-soft-white">
              <span className="mr-3 font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </h3>
            <p className="mt-1 font-mono text-[0.6875rem] text-faint">{s.paths.length > 3 ? `${s.paths.slice(0, 3).join(", ")} +${s.paths.length - 3}` : s.paths.join(", ")}</p>
            {s.body.split("\n\n").map((p, n) => (
              <p key={n} className="mt-3 font-reading text-[1.0625rem] leading-[1.7] text-soft-white/85">
                {p}
              </p>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
