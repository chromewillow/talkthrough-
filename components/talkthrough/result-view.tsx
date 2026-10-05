"use client";

import { Check, ChevronDown, Copy, Download, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fileSlug, repoLabel, scriptStats, toListeningText, toMarkdown } from "@/lib/narrate/assemble";
import type { Walkthrough } from "@/lib/narrate/types";
import { cn } from "@/lib/utils";

type Props = {
  walkthrough: Walkthrough;
  onRetryMissing?: () => void;
  className?: string;
};

export function ResultView({ walkthrough: w, onRetryMissing, className }: Props) {
  const script = useMemo(() => toListeningText(w), [w]);
  const markdown = useMemo(() => toMarkdown(w), [w]);
  const stats = useMemo(() => scriptStats(script), [script]);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"read" | "script">("read");

  async function copy() {
    const ok = await copyText(script);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <section aria-labelledby="result-title" className={cn("panel overflow-clip", className)}>
      <header className="px-5 pt-6 sm:px-8 sm:pt-8">
        <p className="label-caps text-gold/80">Your walkthrough</p>
        <h2 id="result-title" className="mt-3 text-balance font-serif text-[2rem] leading-[1.08] text-soft-white sm:text-[2.5rem]">
          {w.title}
        </h2>
        <p className="mt-3 font-mono text-[0.6875rem] leading-relaxed text-faint">
          {repoLabel(w)} · {stats.words.toLocaleString("en-US")} words · about {stats.minutes} min to listen ·{" "}
          {stats.characters.toLocaleString("en-US")} characters · {w.model}
        </p>
      </header>

      <div className="sticky top-0 z-10 mt-5 border-y border-border bg-[rgb(9_11_20/0.82)] px-5 py-3 backdrop-blur-xl sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={copy} className="basis-full min-[380px]:flex-1 min-[380px]:basis-auto sm:flex-none sm:px-7" aria-live="polite">
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy script"}
          </Button>
          <Button variant="outline" className="flex-1 px-4 min-[380px]:flex-none" onClick={() => download(`${fileSlug(w)}.txt`, script, "text/plain")} aria-label="Download as a text file">
            <Download />
            .txt
          </Button>
          <Button variant="outline" className="flex-1 px-4 min-[380px]:flex-none" onClick={() => download(`${fileSlug(w)}.md`, markdown, "text/markdown")} aria-label="Download as Markdown">
            <Download />
            .md
          </Button>
          <div role="tablist" aria-label="View" className="ml-auto hidden rounded-full border border-border p-1 sm:flex">
            {(["read", "script"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-[0.75rem] transition-colors duration-300",
                  view === v ? "bg-periwinkle/15 text-soft-white" : "text-faint hover:text-soft-white",
                )}
              >
                {v === "read" ? "Formatted" : "Plain script"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 pt-5 pb-8 sm:px-8 sm:pb-10">
        <p className="text-[0.8125rem] leading-relaxed text-faint">
          The copied script is plain text written for the ear — paste it into ElevenLabs.
          {stats.characters > 5000 ? " For a script this long, ElevenLabs Studio (its long-form editor) handles it best." : ""} The
          .md download keeps headings and file paths for reading along.
        </p>

        {w.missing.length > 0 && (
          <div className="mt-5 rounded-2xl border border-gold/25 bg-gold/[0.05] p-4">
            <p className="text-[0.8125rem] leading-relaxed text-gold/90">
              {w.missing.length} part{w.missing.length === 1 ? "" : "s"} couldn&apos;t be written and {w.missing.length === 1 ? "is" : "are"} left out:{" "}
              <span className="font-mono text-[0.75rem]">{w.missing.map((m) => m.label).join(", ")}</span>.
            </p>
            {onRetryMissing && (
              <Button variant="outline" size="sm" className="mt-3" onClick={onRetryMissing}>
                <RotateCcw className="size-3.5" />
                Try those again
              </Button>
            )}
          </div>
        )}

        <Contents w={w} />

        {view === "script" ? (
          <pre className="mt-8 font-reading text-[1.0625rem] leading-[1.75] whitespace-pre-wrap text-soft-white/85">{script}</pre>
        ) : (
          <article className="mx-auto mt-8 max-w-[38rem]">
            <Part id="part-overview" eyebrow="Introduction" title="The big picture" body={w.overview} />
            {w.sections.map((s, i) => (
              <Part
                key={s.id}
                id={`part-${i + 1}`}
                eyebrow={`Part ${i + 1}`}
                title={s.title}
                paths={s.paths}
                body={s.body}
              />
            ))}
            {w.closing && <Part id="part-closing" eyebrow="Finally" title="Where to make changes" body={w.closing} />}
          </article>
        )}
      </div>
    </section>
  );
}

function Contents({ w }: { w: Walkthrough }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6 rounded-2xl border border-border">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left">
        <span className="label-caps">Contents · {w.sections.length + 2} parts</span>
        <ChevronDown className="size-4 text-faint transition-transform duration-300 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <ol className="scroll-quiet max-h-[22rem] space-y-0.5 overflow-y-auto px-2 pb-3">
          <TocItem href="#part-overview" n="·" title="The big picture" />
          {w.sections.map((s, i) => (
            <TocItem key={s.id} href={`#part-${i + 1}`} n={String(i + 1)} title={s.title} />
          ))}
          {w.closing && <TocItem href="#part-closing" n="·" title="Where to make changes" />}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TocItem({ href, n, title }: { href: string; n: string; title: string }) {
  return (
    <li>
      <a href={href} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-[0.875rem] text-muted-foreground transition-colors hover:bg-periwinkle/[0.06] hover:text-soft-white">
        <span className="w-6 shrink-0 text-right font-mono text-[0.6875rem] text-faint">{n}</span>
        {title}
      </a>
    </li>
  );
}

function Part({ id, eyebrow, title, paths, body }: { id: string; eyebrow: string; title: string; paths?: string[]; body: string }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-8 pb-4 first:border-t-0 first:pt-0">
      <p className="label-caps">{eyebrow}</p>
      <h3 className="mt-2 text-balance font-serif text-[1.75rem] leading-tight text-soft-white">{title}</h3>
      {paths && paths.length > 0 && (
        <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed break-words text-periwinkle/70">
          {paths.length > 6 ? `${paths.slice(0, 6).join(" · ")} · +${paths.length - 6} more` : paths.join(" · ")}
        </p>
      )}
      <div className="mt-4 space-y-4">
        {body.split(/\n{2,}/).map((p, i) => (
          <p key={i} className="font-reading text-[1.0625rem] leading-[1.75] text-pretty text-soft-white/85">
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure contexts.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
