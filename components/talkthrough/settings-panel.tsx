"use client";

import { ChevronDown, Eye, EyeOff, KeyRound } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { maskKey, PRESETS, type StoredSettings } from "@/lib/client/settings";
import { normaliseBaseUrl, safeHost } from "@/lib/narrate/llm";
import { cn } from "@/lib/utils";

type Props = {
  value: StoredSettings;
  onChange: (next: StoredSettings) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Highlights the key field when a run needs it. */
  needsKey?: boolean;
};

const SPEEDS = [1, 2, 4, 6];

export function SettingsPanel({ value, onChange, open, onOpenChange, needsKey }: Props) {
  const ids = { base: useId(), key: useId(), model: useId(), models: useId(), remember: useId() };
  const [showKey, setShowKey] = useState(false);
  const models = useModelList(open ? value.baseUrl : "");
  const host = safeHost(normaliseBaseUrl(value.baseUrl) || "—");
  const preset = PRESETS.find((p) => normaliseBaseUrl(p.baseUrl) === normaliseBaseUrl(value.baseUrl));
  const set = (patch: Partial<StoredSettings>) => onChange({ ...value, ...patch });

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        className={cn(
          "group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-border bg-white/[0.015] px-4 py-3 text-left transition-colors duration-300 hover:border-periwinkle/30",
          needsKey && !value.apiKey && "border-gold/40",
        )}
      >
        <KeyRound className="size-4 shrink-0 text-periwinkle" />
        <span className="label-caps shrink-0 text-soft-white/80">Model &amp; key</span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[0.6875rem] text-faint">
          {host} · {value.model || "no model"} · {value.apiKey ? `key ${maskKey(value.apiKey)}` : <span className="text-gold">add a key</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-faint transition-transform duration-300 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="space-y-6 px-1 pt-6 pb-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps mr-1">Provider</span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => set({ baseUrl: p.baseUrl, model: p.model })}
                className={cn(
                  "cursor-pointer rounded-full border px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-300",
                  preset?.name === p.name
                    ? "border-gold/50 bg-gold/10 text-gold"
                    : "border-border text-muted-foreground hover:border-periwinkle/35 hover:text-soft-white",
                )}
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (!preset) return;
                set({ baseUrl: "", model: "" });
                requestAnimationFrame(() => document.getElementById(ids.base)?.focus());
              }}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-300",
                preset
                  ? "border-border text-muted-foreground hover:border-periwinkle/35 hover:text-soft-white"
                  : "border-gold/50 bg-gold/10 text-gold",
              )}
            >
              Custom
            </button>
          </div>

          <Field label="Base URL" htmlFor={ids.base} hint="Any OpenAI-compatible endpoint.">
            <Input
              id={ids.base}
              value={value.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder="https://your-provider.com/v1"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            label="API key"
            htmlFor={ids.key}
            hint={
              preset ? (
                <>
                  Get one at{" "}
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-periwinkle underline-offset-4 hover:underline">
                    {safeHost(preset.keyUrl)}
                  </a>
                  .
                </>
              ) : (
                "From your provider's dashboard."
              )
            }
          >
            <div className="relative">
              <Input
                id={ids.key}
                type={showKey ? "text" : "password"}
                value={value.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                placeholder={preset?.keyHint ?? "Your API key"}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={needsKey && !value.apiKey ? true : undefined}
                className="pr-12 font-mono text-[0.8125rem]"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-faint transition-colors hover:text-soft-white"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>

          <Field label="Model" htmlFor={ids.model} hint={models.length ? `${models.length} models available from ${host}.` : "The exact model name your provider uses."}>
            <Input
              id={ids.model}
              list={ids.models}
              value={value.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder="anthropic/claude-sonnet-5.5"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[0.8125rem]"
            />
            <datalist id={ids.models}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3">
              <Label htmlFor={ids.remember} className="cursor-pointer tracking-[0.18em]">
                Remember on this device
              </Label>
              <Switch id={ids.remember} checked={value.remember} onCheckedChange={(remember) => set({ remember })} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3">
              <span className="label-caps tracking-[0.18em]">Parallel requests</span>
              <div role="radiogroup" aria-label="Parallel requests" className="flex gap-1">
                {SPEEDS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={value.concurrency === n}
                    onClick={() => set({ concurrency: n })}
                    className={cn(
                      "size-7 cursor-pointer rounded-full font-mono text-[0.75rem] transition-colors duration-300",
                      value.concurrency === n ? "bg-gold/15 text-gold" : "text-faint hover:text-soft-white",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[0.8125rem] leading-relaxed text-faint">
            Your key stays in this browser{value.remember ? " (saved locally)" : " for this session only"}. Requests go
            straight from your browser to {host}. If a provider blocks browser requests, they pass through this
            site&apos;s relay, which forwards them without logging or storing anything.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[0.75rem] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

/**
 * Asks the provider which models exist, for autocomplete. The API key is never
 * sent here: this runs as you type or switch presets, before you've pressed
 * Generate, and the key belongs only to the provider you actually use. Most
 * providers list models without one; for the rest, autocomplete just stays off.
 */
function useModelList(baseUrl: string): string[] {
  const [models, setModels] = useState<{ key: string; list: string[] }>({ key: "", list: [] });
  const url = normaliseBaseUrl(baseUrl);
  const complete = (() => {
    try {
      return /\.[a-z]{2,}$|^localhost$|^[\d.]+$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!url || !complete || models.key === url) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${url}/models`, { signal: controller.signal, credentials: "omit" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { id?: string }[] };
        const list = (json.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string")
          .sort()
          .slice(0, 600);
        setModels({ key: url, list });
      } catch {
        // CORS, offline or no /models endpoint: autocomplete is optional.
      }
    }, 800);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, complete, models.key]);

  return models.key === url ? models.list : [];
}
