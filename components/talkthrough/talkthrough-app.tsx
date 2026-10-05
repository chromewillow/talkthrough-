"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FriendlyError, ingest } from "@/lib/client/ingest";
import type { IngestResult } from "@/lib/ingest/types";
import { buildTree } from "@/lib/tree";
import { FileTree } from "./file-tree";

type State =
  | { phase: "idle" }
  | { phase: "ingesting" }
  | { phase: "ingested"; result: IngestResult }
  | { phase: "error"; error: FriendlyError };

export function TalkthroughApp() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const busy = state.phase === "ingesting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: "ingesting" });
    try {
      const result = await ingest(url, controller.signal);
      setState({ phase: "ingested", result });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        phase: "error",
        error: err instanceof FriendlyError ? err : new FriendlyError("Something went wrong", String(err)),
      });
    }
  }

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

      <form onSubmit={onSubmit} className="panel p-5 sm:p-7">
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
          required
        />
        <div className="mt-6 flex justify-end">
          <Button type="submit" size="lg" disabled={busy || !url.trim()} className="w-full sm:w-auto">
            {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
            {busy ? "Reading repository" : "Read repository"}
          </Button>
        </div>
      </form>

      {state.phase === "error" && (
        <div role="alert" className="panel mt-6 border-destructive/25 p-5 sm:p-6">
          <p className="font-serif text-xl text-soft-white">{state.error.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{state.error.message}</p>
        </div>
      )}

      {state.phase === "ingested" && <RepoSummary result={state.result} />}
    </main>
  );
}

function RepoSummary({ result }: { result: IngestResult }) {
  const tree = useMemo(() => buildTree(result.files, result.skipped), [result]);
  return (
    <section className="panel mt-6 p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="font-serif text-2xl text-soft-white">
          {result.repo.owner}/{result.repo.repo}
        </h2>
        <p className="font-mono text-[0.75rem] text-faint">
          {result.stats.includedFiles} files kept · {result.stats.skippedEntries} skipped
        </p>
      </div>
      {result.notes.map((n) => (
        <p key={n} className="mt-3 text-sm text-muted-foreground">
          {n}
        </p>
      ))}
      <div className="scroll-quiet mt-5 max-h-[28rem] overflow-y-auto pr-1">
        <FileTree root={tree} />
      </div>
    </section>
  );
}
