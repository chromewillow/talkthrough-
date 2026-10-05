import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, LlmError, newSession, normaliseBaseUrl, withRetries } from "@/lib/narrate/llm";

const settings = { baseUrl: "https://api.example.com/v1/", apiKey: " sk-test ", model: "m" };
const msgs = [{ role: "user" as const, content: "hi" }];
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("chat", () => {
  it("posts to /chat/completions with a trimmed key and returns the text", async () => {
    const fetchMock = vi.fn(async () => json(200, { choices: [{ message: { content: "hello" }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await chat(settings, newSession(), msgs, { maxTokens: 10, temperature: 0.5 });
    expect(r.text).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", max_tokens: 10, temperature: 0.5 });
  });

  it.each([
    [401, { error: { message: "Invalid API key" } }, "auth"],
    [402, { error: { message: "Insufficient credits" } }, "credits"],
    [404, { error: { message: "model not found" } }, "model"],
    [429, { error: { message: "slow down" } }, "rate_limit"],
    [503, { error: { message: "overloaded" } }, "rate_limit"],
    [500, { error: { message: "boom" } }, "server"],
    [400, { error: { message: "This model's maximum context length is 8192 tokens" } }, "context"],
  ])("classifies HTTP %s", async (status, body, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(status, body)));
    await expect(chat(settings, newSession(), msgs, { maxTokens: 10, temperature: 0.5 })).rejects.toMatchObject({ kind });
  });

  it("adapts to models that reject max_tokens and temperature", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        bodies.push(body);
        if ("max_tokens" in body) return json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } });
        if ("temperature" in body) return json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.5" } });
        return json(200, { choices: [{ message: { content: "ok" } }] });
      }),
    );
    const session = newSession();
    await expect(chat(settings, session, msgs, { maxTokens: 10, temperature: 0.5 })).resolves.toMatchObject({ text: "ok" });
    expect(session).toMatchObject({ tokenParam: "max_completion_tokens", sendTemperature: false });
    expect(bodies[bodies.length - 1]).toMatchObject({ max_completion_tokens: 10 });
  });

  it("doesn't over-correct when several requests fail on the same unsupported parameter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        await new Promise((r) => setTimeout(r, 5));
        if ("max_tokens" in body) return json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } });
        return json(200, { choices: [{ message: { content: "ok" } }] });
      }),
    );
    const session = newSession();
    const results = await Promise.all([1, 2, 3, 4].map(() => chat(settings, session, msgs, { maxTokens: 10, temperature: 0.5 })));
    expect(results.every((r) => r.text === "ok")).toBe(true);
    expect(session.tokenParam).toBe("max_completion_tokens");
  });

  it("gives a cut-off answer more room, then marks it truncated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { choices: [{ message: { content: "Half a sent" }, finish_reason: "length" }] })));
    const r = await chat(settings, newSession(), msgs, { maxTokens: 10, temperature: 0.5 });
    expect(r).toMatchObject({ text: "Half a sent", truncated: true });
  });

  it("treats a relay that can't reach the provider as a network problem and stays direct", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://")) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ error: { message: "Couldn't connect" } }), {
          status: 502,
          headers: { "x-talkthrough-relay": "refused" },
        });
      }),
    );
    const session = newSession();
    await expect(chat(settings, session, msgs, { maxTokens: 10, temperature: 0.5 })).rejects.toMatchObject({ kind: "network" });
    expect(session.transport).toBe("direct");
  });

  it("falls back to the relay when the browser request is blocked", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://")) throw new TypeError("Failed to fetch");
      return json(200, { choices: [{ message: { content: "via relay" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const session = newSession();
    const r = await chat(settings, session, msgs, { maxTokens: 10, temperature: 0.5 });
    expect(r.text).toBe("via relay");
    expect(session.transport).toBe("relay");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/llm");
  });

  it("gives reasoning models more room when they run out before answering", async () => {
    const seen: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        seen.push(body.max_tokens);
        return body.max_tokens < 40
          ? json(200, { choices: [{ message: { content: "" }, finish_reason: "length" }] })
          : json(200, { choices: [{ message: { content: "thought it through" } }] });
      }),
    );
    const session = newSession();
    await expect(chat(settings, session, msgs, { maxTokens: 10, temperature: 0.5 })).resolves.toMatchObject({ text: "thought it through" });
    expect(seen).toEqual([10, 20, 40]);
    expect(session.tokenBoost).toBe(4);
  });

  it("treats a provider error reported inside a choice as a server problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { choices: [{ error: { message: "upstream timeout", code: 502 } }] })));
    await expect(chat(settings, newSession(), msgs, { maxTokens: 10, temperature: 0.5 })).rejects.toMatchObject({ kind: "server" });
  });

  it("gives up on a stuck provider without switching to the relay", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const session = newSession();
    await expect(chat(settings, session, msgs, { maxTokens: 10, temperature: 0.5, timeoutMs: 20 })).rejects.toMatchObject({ kind: "server" });
    expect(session.transport).toBe("direct");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an empty answer as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { choices: [{ message: { content: "" }, finish_reason: "length" }] })));
    await expect(chat(settings, newSession(), msgs, { maxTokens: 10, temperature: 0.5 })).rejects.toMatchObject({ kind: "empty" });
  });
});

describe("withRetries", () => {
  it("retries transient errors and gives up on fatal ones", async () => {
    vi.useFakeTimers();
    let n = 0;
    const p = withRetries(async () => {
      if (++n < 3) throw new LlmError("rate_limit", "slow", 429, 10);
      return "done";
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("done");
    expect(n).toBe(3);

    let m = 0;
    await expect(
      withRetries(async () => {
        m++;
        throw new LlmError("auth", "nope", 401);
      }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(m).toBe(1);
    vi.useRealTimers();
  });
});

describe("normaliseBaseUrl", () => {
  it("adds https, trims slashes and strips a pasted endpoint path", () => {
    expect(normaliseBaseUrl("openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1");
    expect(normaliseBaseUrl("https://x.y/v1/chat/completions")).toBe("https://x.y/v1");
  });
});
