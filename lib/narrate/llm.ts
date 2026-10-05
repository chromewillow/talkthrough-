/**
 * A small client for any OpenAI-compatible chat completions endpoint.
 *
 * Requests go straight from the browser to the provider, so the API key
 * never touches our server. A few providers refuse browser requests (CORS);
 * for those we fall back to a stateless relay on this site that forwards the
 * request without logging or storing anything.
 */
import type { ChatMessage } from "./prompts";
import type { LlmSettings } from "./types";

export type LlmErrorKind =
  | "auth"
  | "credits"
  | "model"
  | "rate_limit"
  | "context"
  | "server"
  | "network"
  | "bad_request"
  | "empty"
  | "aborted";

export class LlmError extends Error {
  /** Set when the model hit its token limit before producing any text. */
  outOfRoom = false;

  constructor(
    public kind: LlmErrorKind,
    message: string,
    public status?: number,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Errors that will fail the same way on every request: stop the whole run. */
export function isFatal(err: unknown): boolean {
  return err instanceof LlmError && ["auth", "credits", "model", "bad_request"].includes(err.kind);
}

export function isRetryable(err: unknown): boolean {
  return err instanceof LlmError && ["rate_limit", "server", "network", "empty"].includes(err.kind);
}

export type Transport = "direct" | "relay";

/** Per-session learnings about the endpoint, shared by every request. */
export type Session = {
  transport: Transport;
  /** Some models want max_completion_tokens; some reject temperature. */
  tokenParam: "max_tokens" | "max_completion_tokens" | "none";
  sendTemperature: boolean;
  /** Reasoning models spend tokens thinking; this grows when one runs out of room. */
  tokenBoost: number;
};

export function newSession(): Session {
  return { transport: "direct", tokenParam: "max_tokens", sendTemperature: true, tokenBoost: 1 };
}

const MAX_TOKEN_BOOST = 4;

export function normaliseBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  // People often paste the full endpoint.
  url = url.replace(/\/chat\/completions$/i, "");
  return url;
}

function isOpenRouter(baseUrl: string) {
  return /(^|\.)openrouter\.ai$/i.test(safeHost(baseUrl));
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type CallOptions = {
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ChatResult = { text: string; finishReason: string | null };

export async function chat(settings: LlmSettings, session: Session, messages: ChatMessage[], opts: CallOptions): Promise<ChatResult> {
  // Up to two quiet retries to adapt request parameters to what the model accepts.
  for (let adapt = 0; adapt < 4; adapt++) {
    try {
      return await chatOnce(settings, session, messages, opts);
    } catch (err) {
      if (err instanceof LlmError && err.kind === "bad_request" && adaptParams(session, err.message)) continue;
      // Ran out of room before writing anything: give later requests more.
      if (err instanceof LlmError && err.outOfRoom && session.tokenParam !== "none" && session.tokenBoost < MAX_TOKEN_BOOST) {
        session.tokenBoost *= 2;
        continue;
      }
      throw err;
    }
  }
  return chatOnce(settings, session, messages, opts);
}

/** Learns from "unsupported parameter" errors. Returns true if something changed. */
function adaptParams(session: Session, message: string): boolean {
  const m = message.toLowerCase();
  if (session.tokenParam === "max_tokens" && m.includes("max_tokens") && (m.includes("max_completion_tokens") || m.includes("unsupported") || m.includes("not supported"))) {
    session.tokenParam = "max_completion_tokens";
    return true;
  }
  if (session.tokenParam === "max_completion_tokens" && m.includes("max_completion_tokens")) {
    session.tokenParam = "none";
    return true;
  }
  if (session.sendTemperature && m.includes("temperature")) {
    session.sendTemperature = false;
    return true;
  }
  return false;
}

/** Longest we'll wait for one answer before treating the provider as stuck. */
export const REQUEST_TIMEOUT_MS = 180_000;

/** The caller's signal plus a timeout we can tell apart from a deliberate stop. */
function deadline(outer: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut && !outer?.aborted,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

async function chatOnce(settings: LlmSettings, session: Session, messages: ChatMessage[], opts: CallOptions): Promise<ChatResult> {
  const d = deadline(opts.signal, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    return await chatAttempt(settings, session, messages, opts, d);
  } catch (err) {
    if (d.timedOut()) {
      throw new LlmError("server", `${safeHost(normaliseBaseUrl(settings.baseUrl))} took too long to answer.`);
    }
    throw err;
  } finally {
    d.done();
  }
}

async function chatAttempt(
  settings: LlmSettings,
  session: Session,
  messages: ChatMessage[],
  opts: CallOptions,
  d: ReturnType<typeof deadline>,
): Promise<ChatResult> {
  const baseUrl = normaliseBaseUrl(settings.baseUrl);
  const signal = d.signal;
  const payload: Record<string, unknown> = { model: settings.model.trim(), messages };
  if (session.tokenParam !== "none") payload[session.tokenParam] = opts.maxTokens * session.tokenBoost;
  if (session.sendTemperature) payload.temperature = opts.temperature;

  let res: Response;
  if (session.transport === "direct") {
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: providerHeaders(settings, baseUrl),
        body: JSON.stringify(payload),
        signal,
      });
    } catch {
      if (d.timedOut()) throw new LlmError("server", `${safeHost(baseUrl)} took too long to answer.`);
      if (opts.signal?.aborted) throw new LlmError("aborted", "Stopped.");
      // A TypeError here is usually CORS: the provider won't talk to browsers.
      // Try once through the relay; if that works, stick with it.
      session.transport = "relay";
      try {
        return await chatAttempt(settings, session, messages, opts, d);
      } catch (relayErr) {
        if (relayErr instanceof LlmError && relayErr.kind === "network") {
          session.transport = "direct";
          throw new LlmError(
            "network",
            `We couldn't reach ${safeHost(baseUrl)}. Check the base URL in Settings and your internet connection.`,
          );
        }
        throw relayErr;
      }
    }
  } else {
    try {
      res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey.trim()}` },
        body: JSON.stringify({ baseUrl, payload }),
        signal,
      });
    } catch {
      if (d.timedOut()) throw new LlmError("server", `${safeHost(baseUrl)} took too long to answer.`);
      if (opts.signal?.aborted) throw new LlmError("aborted", "Stopped.");
      throw new LlmError("network", "We couldn't reach the Talkthrough relay. Check your internet connection.");
    }
  }

  if (!res.ok) throw await toError(res, settings, baseUrl);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (opts.signal?.aborted) throw new LlmError("aborted", "Stopped.");
    throw new LlmError("server", `${safeHost(baseUrl)} sent back something that wasn't valid JSON.`);
  }
  // Some providers report errors inside a 200 response.
  const embedded = (data as { error?: { message?: string; code?: number | string } }).error;
  if (embedded) throw classify(Number(embedded.code) || 500, embedded.message ?? "Unknown error", settings, baseUrl, null);

  const choice = (
    data as { choices?: { message?: { content?: unknown }; finish_reason?: string; error?: { message?: string; code?: number } }[] }
  ).choices?.[0];
  // OpenRouter can report an upstream provider failure inside the choice.
  if (choice?.error) throw classify(Number(choice.error.code) || 502, choice.error.message ?? "Provider error", settings, baseUrl, null);
  const text = extractText(choice?.message?.content);
  if (!text.trim()) {
    const outOfRoom = choice?.finish_reason === "length";
    const err = new LlmError(
      "empty",
      outOfRoom
        ? "The model ran out of room before writing anything. Reasoning-heavy models sometimes do this; try a different model."
        : "The model sent back an empty answer.",
    );
    err.outOfRoom = outOfRoom;
    throw err;
  }
  return { text, finishReason: choice?.finish_reason ?? null };
}

function providerHeaders(settings: LlmSettings, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey.trim()}`,
  };
  if (isOpenRouter(baseUrl)) {
    // OpenRouter's optional app attribution.
    headers["X-Title"] = "Talkthrough";
    if (typeof window !== "undefined") headers["HTTP-Referer"] = window.location.origin;
  }
  return headers;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

async function toError(res: Response, settings: LlmSettings, baseUrl: string): Promise<LlmError> {
  const raw = await res.text().catch(() => "");
  let message = raw;
  try {
    const json = JSON.parse(raw) as { error?: { message?: string; metadata?: { raw?: string } } | string; message?: string; detail?: string };
    const e = json.error;
    message =
      (typeof e === "string" ? e : (e?.metadata?.raw ?? e?.message)) ?? json.message ?? json.detail ?? raw;
  } catch {
    // Not JSON; keep the text.
  }
  const retryAfter = parseRetryAfter(res.headers);
  // The relay marks its own refusals so we don't blame the provider.
  if (res.headers.get("x-talkthrough-relay") === "refused") {
    return new LlmError("bad_request", message || "The relay refused this request.", res.status);
  }
  return classify(res.status, String(message).slice(0, 600), settings, baseUrl, retryAfter);
}

function parseRetryAfter(headers: Headers): number | null {
  const ra = headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.min(120_000, Math.max(0, secs * 1000));
    const date = Date.parse(ra);
    if (Number.isFinite(date)) return Math.min(120_000, Math.max(0, date - Date.now()));
  }
  const reset = headers.get("x-ratelimit-reset") ?? headers.get("x-ratelimit-reset-requests");
  if (reset) {
    const n = Number(reset);
    // Either epoch milliseconds (OpenRouter) or a duration like "12s".
    if (Number.isFinite(n) && n > 1e12) return Math.min(120_000, Math.max(0, n - Date.now()));
    const secs = reset.match(/^([\d.]+)s$/)?.[1];
    if (secs) return Math.min(120_000, Number(secs) * 1000);
  }
  return null;
}

function classify(status: number, message: string, settings: LlmSettings, baseUrl: string, retryAfter: number | null): LlmError {
  const host = safeHost(baseUrl);
  const m = message.toLowerCase();
  const detail = message ? ` (${host} said: "${truncate(message, 180)}")` : "";

  if (/context|too many tokens|maximum.*tokens|token limit|prompt is too long|input is too long|reduce the length/.test(m) && status !== 429) {
    return new LlmError("context", `This request was too long for the model.${detail}`, status);
  }
  if (status === 401 || /invalid api key|incorrect api key|no auth|unauthori[sz]ed|invalid_api_key/.test(m)) {
    return new LlmError(
      "auth",
      `${host} rejected the API key. Open Settings and check it, and make sure it belongs to the same provider as the base URL.${detail}`,
      status,
    );
  }
  if (status === 402 || /insufficient (credit|quota|funds|balance)|quota exceeded|billing|credits/.test(m)) {
    return new LlmError(
      "credits",
      `Your ${host} account doesn't have enough credit for this. Top it up, or choose a cheaper model in Settings.${detail}`,
      status,
    );
  }
  if (status === 404 || /model.*(not found|does not exist|not available|invalid)|no endpoints found|unknown model/.test(m)) {
    return new LlmError(
      "model",
      `${host} doesn't recognise the model "${settings.model}", or the base URL is wrong. Check the exact model name in Settings${isOpenRouter(baseUrl) ? " — on OpenRouter it looks like anthropic/claude-sonnet-5.5" : ""}.${detail}`,
      status,
    );
  }
  if (status === 429 || /rate.?limit|too many requests|overloaded/.test(m)) {
    return new LlmError("rate_limit", `${host} is rate-limiting requests.${detail}`, status, retryAfter ?? undefined);
  }
  if (status === 403) {
    return new LlmError(
      "auth",
      `${host} refused the request. The key may not have access to this model, or the request was blocked.${detail}`,
      status,
    );
  }
  if (status >= 500 || status === 408 || status === 409 || status === 425) {
    return new LlmError("server", `${host} had a temporary problem${status ? ` (${status})` : ""}.${detail}`, status, retryAfter ?? undefined);
  }
  return new LlmError("bad_request", `${host} rejected the request.${detail}`, status);
}

function truncate(s: string, n: number) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

export type RetryNotice = { attempt: number; waitMs: number; error: LlmError };

/**
 * Retries transient failures with exponential backoff (honouring
 * Retry-After), and gives up immediately on anything that won't get better.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  { retries = 4, signal, onRetry }: { retries?: number; signal?: AbortSignal; onRetry?: (n: RetryNotice) => void } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted) throw new LlmError("aborted", "Stopped.");
      if (!isRetryable(err) || attempt >= retries) throw err;
      const e = err as LlmError;
      const base = e.kind === "rate_limit" ? 4000 : 1500;
      const backoff = Math.min(60_000, base * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      const waitMs = Math.max(e.retryAfterMs ?? 0, backoff);
      onRetry?.({ attempt: attempt + 1, waitMs, error: e });
      await sleep(waitMs, signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new LlmError("aborted", "Stopped."));
      },
      { once: true },
    );
  });
}
