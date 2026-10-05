import type { LlmSettings } from "@/lib/narrate/types";

/**
 * Model settings live only in this browser. The API key is stored in
 * localStorage when "remember" is on, and in memory otherwise.
 */

export type StoredSettings = LlmSettings & {
  remember: boolean;
  concurrency: number;
  /** Give each part a second look: better narration, about twice the requests. */
  revise: boolean;
};

export const DEFAULT_SETTINGS: StoredSettings = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5.5",
  remember: true,
  concurrency: 4,
  revise: true,
};

export type ProviderPreset = { name: string; baseUrl: string; model: string; keyHint: string; keyUrl: string };

export const PRESETS: ProviderPreset[] = [
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-5.5",
    keyHint: "sk-or-…",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
];

const KEY = "talkthrough:settings:v1";

export function loadSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      concurrency: clampConcurrency(parsed.concurrency ?? DEFAULT_SETTINGS.concurrency),
      revise: parsed.revise !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: StoredSettings) {
  try {
    const toStore: StoredSettings = { ...s, apiKey: s.remember ? s.apiKey : "" };
    window.localStorage.setItem(KEY, JSON.stringify(toStore));
  } catch {
    // Private mode or storage full: settings just won't persist.
  }
}

export function clampConcurrency(n: number) {
  return Math.min(8, Math.max(1, Math.round(Number(n) || 1)));
}

/** Short, safe-to-show version of a key: "sk-or-…f3a9". */
export function maskKey(key: string) {
  const k = key.trim();
  if (k.length <= 10) return k ? "•".repeat(k.length) : "";
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
