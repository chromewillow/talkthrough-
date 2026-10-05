"use client";

import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { RunState } from "@/lib/client/run-state";
import { sectionPaths } from "@/lib/narrate/plan";
import { buildTree } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { FileTree, type FileStatus } from "./file-tree";

type StepState = "pending" | "active" | "done" | "failed";

export function ProgressView({ run, className }: { run: RunState; className?: string }) {
  const total = run.plan?.sections.length ?? 0;
  const done = run.plan ? run.plan.sections.filter((s) => run.results[s.id]).length : 0;
  const failedCount = Object.keys(run.failed).length;
  const activeIds = Object.keys(run.active);

  const order = ["reading", "explaining", "overview", "done"] as const;
  const at = run.phase === "failed" || run.phase === "stopped" ? stoppedAt(run) : order.indexOf(run.phase as (typeof order)[number]);
  const stepState = (i: number): StepState => {
    if (i < at) return "done";
    if (i === at) return run.phase === "failed" || run.phase === "stopped" ? "failed" : run.phase === "done" ? "done" : "active";
    return "pending";
  };

  const status = useMemo(() => {
    const map: Record<string, FileStatus> = {};
    if (!run.plan) return map;
    for (const s of run.plan.sections) {
      const st: FileStatus = run.results[s.id] ? "done" : run.active[s.id] ? "active" : run.failed[s.id] ? "failed" : "queued";
      for (const p of sectionPaths(s)) map[p] = st;
    }
    return map;
  }, [run.plan, run.results, run.active, run.failed]);

  const tree = useMemo(() => (run.ingest ? buildTree(run.ingest.files, run.ingest.skipped) : null), [run.ingest]);
  const [showFiles, setShowFiles] = useState(false);
  const latest = run.latest ? run.results[run.latest] : undefined;

  const labelFor = (id: string) => {
    const s = run.plan?.sections.find((x) => x.id === id);
    if (!s) return id;
    const a = run.active[id];
    const base = s.kind === "file" ? s.path : s.title.toLowerCase();
    if (a?.revising) return `${base} · second look`;
    return a?.total ? `${base} · part ${a.part} of ${a.total}` : base;
  };

  // Screen readers hear a short status at meaningful moments, not every snippet and counter.
  const stepSize = Math.max(1, Math.ceil(total / 5));
  const coarseDone = done === total ? done : Math.floor(done / stepSize) * stepSize;
  const srStatus =
    run.phase === "reading"
      ? "Reading the repository."
      : run.phase === "explaining"
        ? `Explaining files: ${coarseDone} of ${total} done${failedCount ? `, ${failedCount} couldn't be explained` : ""}.`
        : run.phase === "overview"
          ? "Writing the overview and the guide to changes."
          : run.phase === "stopped"
            ? "Stopped."
            : "";

  return (
    <section aria-labelledby="progress-title" className={cn("panel p-5 sm:p-7", className)}>
      <h2 id="progress-title" tabIndex={-1} className="sr-only">
        Progress
      </h2>
      <p role="status" className="sr-only">
        {srStatus}
      </p>
      <ol className="space-y-5">
        <Step state={stepState(0)} title="Reading the repository">
          {run.ingest ? (
            <Meta>
              {run.ingest.repo.owner}/{run.ingest.repo.repo} · {run.ingest.stats.includedFiles} files kept ·{" "}
              {run.ingest.stats.skippedEntries} skipped
            </Meta>
          ) : run.phase === "reading" ? (
            <Meta>Downloading and sorting the files…</Meta>
          ) : null}
        </Step>

        <Step state={stepState(1)} title="Explaining each file">
          {run.plan && (
            <>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-px flex-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-periwinkle/70 to-gold transition-[width] duration-700 ease-out"
                    style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                  />
                </div>
                <Meta className="mt-0 shrink-0 tabular-nums">
                  {done} of {total} parts
                </Meta>
              </div>
              {activeIds.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {activeIds.slice(0, 4).map((id) => (
                    <li key={id} className="truncate font-mono text-[0.6875rem] text-periwinkle/80">
                      {labelFor(id)}
                    </li>
                  ))}
                  {activeIds.length > 4 && <li className="font-mono text-[0.6875rem] text-faint">and {activeIds.length - 4} more</li>}
                </ul>
              )}
              {failedCount > 0 && (
                <Meta className="text-destructive/80">
                  {failedCount} part{failedCount === 1 ? "" : "s"} couldn&apos;t be explained{run.phase === "explaining" ? " — carrying on" : ""}.
                </Meta>
              )}
            </>
          )}
        </Step>

        <Step state={stepState(2)} title="Writing the overview and the guide to changes" />
        <Step state={stepState(3)} title="Assembling the script" />
      </ol>

      {run.notice && <p className="mt-6 rounded-2xl border border-gold/20 bg-gold/[0.05] px-4 py-3 text-[0.8125rem] leading-relaxed text-gold/90">{run.notice}</p>}
      {run.relay && run.phase !== "done" && (
        <p className="mt-4 text-[0.75rem] leading-relaxed text-faint">
          Your provider doesn&apos;t accept requests straight from browsers, so they&apos;re passing through this site&apos;s relay. Nothing is
          stored.
        </p>
      )}

      {latest && run.phase === "explaining" && (
        <figure className="mt-6 border-l border-periwinkle/25 pl-4">
          <figcaption className="label-caps">Just written · {latest.title}</figcaption>
          <blockquote className="mt-2 line-clamp-3 font-reading text-[0.9375rem] leading-relaxed font-[450] text-soft-white/80 italic">
            {latest.body}
          </blockquote>
        </figure>
      )}

      {tree && (
        <Collapsible open={showFiles} onOpenChange={setShowFiles} className="mt-6 border-t border-border pt-4">
          <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between text-left">
            <span className="label-caps">Files</span>
            <ChevronDown className="size-4 text-faint transition-transform duration-300 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <div className="scroll-quiet mt-3 max-h-[24rem] overflow-y-auto pr-1">
              <FileTree root={tree} status={status} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

function stoppedAt(run: RunState) {
  if (!run.ingest) return 0;
  if (run.plan && run.plan.sections.every((s) => run.results[s.id])) return 2;
  return 1;
}

function Step({ state, title, children }: { state: StepState; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="relative mt-[0.3rem] flex size-4 shrink-0 items-center justify-center">
        {state === "done" && (
          <span className="flex size-4 items-center justify-center rounded-full bg-periwinkle/15 text-periwinkle">
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        )}
        {state === "active" && <span className="size-2 rounded-full bg-gold motion-safe:animate-breathe" />}
        {state === "pending" && <span className="size-2 rounded-full border border-faint/60" />}
        {state === "failed" && <span className="size-2 rounded-full bg-destructive/80" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[0.9375rem] transition-colors duration-500",
            state === "active" ? "text-soft-white" : state === "done" ? "text-soft-white/70" : "text-faint",
          )}
        >
          {title}
        </p>
        {children}
      </div>
      <span className="sr-only">{state}</span>
    </li>
  );
}

function Meta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1 font-mono text-[0.6875rem] leading-relaxed text-faint", className)}>{children}</p>;
}
