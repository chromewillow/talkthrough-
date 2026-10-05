import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeFiles } from "@/lib/ingest/analyze";
import type { IngestResult } from "@/lib/ingest/types";
import { newSession } from "@/lib/narrate/llm";
import { endAtSentence, halve, runWalkthrough, type PipelineEvent } from "@/lib/narrate/pipeline";
import { buildPlan } from "@/lib/narrate/plan";
import type { SectionResult } from "@/lib/narrate/types";

const body = (n: number) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n");

function demo(): IngestResult {
  const files = analyzeFiles([
    { path: "src/index.ts", size: 10, content: `import { a } from "./a";\n${body(60)}` },
    { path: "src/a.ts", size: 10, content: body(70) },
    { path: "src/b.ts", size: 10, content: body(70) },
    { path: "package.json", size: 10, content: "{}" },
  ]);
  return {
    repo: { owner: "me", repo: "demo", ref: "HEAD", subpath: "", htmlUrl: "" },
    files,
    skipped: [],
    readmePath: null,
    stats: { totalEntries: 4, includedFiles: 4, includedBytes: 0, skippedEntries: 0, unlistedSkipped: 0 },
    notes: [],
  };
}

const settings = { baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m" };
const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });

function reply(init: RequestInit) {
  const user = JSON.parse(init.body as string).messages[1].content as string;
  const file = user.match(/<file path="([^"]+)">/)?.[1];
  if (!user.includes("TITLE:")) return ok(user.includes("closing part") ? "Closing words." : "Overview words.");
  return ok(`TITLE: About ${file ?? "group"}\n\nNarration for ${file ?? "group"}.\n\nSUMMARY: Summary of ${file ?? "group"}.`);
}

afterEach(() => vi.unstubAllGlobals());

describe("runWalkthrough", () => {
  it("explains every section, then writes the overview and closing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => reply(init)));
    const ingest = demo();
    const plan = buildPlan(ingest);
    const events: PipelineEvent[] = [];
    const outcome = await runWalkthrough({
      ingest,
      plan,
      settings,
      options: { length: "medium", concurrency: 2 },
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      session: newSession(),
    });
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    expect(outcome.walkthrough.sections.map((s) => s.id)).toEqual(plan.sections.map((s) => s.id));
    expect(outcome.walkthrough.overview).toBe("Overview words.");
    expect(outcome.walkthrough.closing).toBe("Closing words.");
    expect(outcome.walkthrough.sections[0]).toMatchObject({ title: "About src/index.ts", summary: "Summary of src/index.ts." });
    expect(events.filter((e) => e.type === "section-done")).toHaveLength(plan.sections.length);
  });

  it("tells later parts what earlier ones established, and writes the closing after the introduction", async () => {
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const user = JSON.parse(init.body as string).messages[1].content as string;
        prompts.push(user);
        const file = user.match(/<file path="([^"]+)">/)?.[1];
        if (user.includes("closing part")) return ok("Closing words.");
        if (!user.includes("TITLE:")) return ok("NAME: Demo\n\nOverview words.\n\nCHAPTER 1: Getting going\nBRIDGE 2: Next, the rest.");
        return ok(`TITLE: About ${file ?? "group"}\n\nNarration.\n\nTERMS: widget\n\nSUMMARY: Facts from ${file ?? "group"}.`);
      }),
    );
    const ingest = demo();
    const plan = buildPlan(ingest);
    const outcome = await runWalkthrough({
      ingest,
      plan,
      settings,
      options: { length: "medium", concurrency: 1 },
      signal: new AbortController().signal,
      onEvent: () => {},
      session: newSession(),
    });
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    const second = prompts.find((p) => p.includes(`<file path="${plan.sections[1].kind === "file" ? plan.sections[1].path : ""}">`))!;
    expect(second).toContain("<heard>");
    expect(second).toContain("Facts from src/index.ts.");
    expect(second).toMatch(/already had explained: [^\n]*widget/);
    expect(outcome.walkthrough.name).toBe("Demo");
    expect(outcome.walkthrough.title).toBe("A guided tour of Demo");
    expect(outcome.walkthrough.overview).toBe("Overview words.");
    expect(prompts[prompts.length - 1]).toContain("<introduction>\nOverview words.\n</introduction>");
    // The introduction names the chapters and leads into each one after the first.
    const sections = outcome.walkthrough.sections;
    expect(sections[0].chapterTitle).toBe("Getting going");
    const secondChapter = sections.find((s) => s.chapter !== sections[0].chapter);
    if (secondChapter) expect(secondChapter.bridge).toBe("Next, the rest.");
  });

  it("skips sections finished by an earlier attempt", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => reply(init));
    vi.stubGlobal("fetch", fetchMock);
    const ingest = demo();
    const plan = buildPlan(ingest);
    const first = plan.sections[0];
    const done: Record<string, SectionResult> = {
      [first.id]: { id: first.id, title: "Cached", body: "Cached body.", summary: "Cached.", paths: [] },
    };
    const outcome = await runWalkthrough({
      ingest,
      plan,
      settings,
      options: { length: "medium", concurrency: 1 },
      done,
      signal: new AbortController().signal,
      onEvent: () => {},
      includeOverview: false,
    });
    expect(outcome.status).toBe("sections");
    // A draft and a second look for each part that wasn't finished.
    expect(fetchMock).toHaveBeenCalledTimes(2 * (plan.sections.length - 1));
    if (outcome.status === "sections") expect(outcome.sections[0].title).toBe("Cached");
  });

  it("revises each draft in its own conversation, with what came before it", async () => {
    const calls: { role: string; content: string }[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const messages = JSON.parse(init.body as string).messages as { role: string; content: string }[];
        calls.push(messages);
        const file = messages[1].content.match(/<file path="([^"]+)">/)?.[1] ?? "group";
        if (messages.length > 2) {
          // The second look: an empty answer for one file shows the draft standing.
          if (file === "src/b.ts") return ok("TITLE: Nothing\n\n");
          return ok(`TITLE: Revised ${file}\n\nRevised narration for ${file}.\n\nBUGS: none\n\nSUMMARY: Revised summary of ${file}.`);
        }
        return ok(`TITLE: About ${file}\n\nDraft narration for ${file}.\n\nEXPLAINED: how ${file} works\n\nSUMMARY: Summary of ${file}.`);
      }),
    );
    const ingest = demo();
    const plan = buildPlan(ingest);
    const outcome = await runWalkthrough({
      ingest,
      plan,
      settings,
      options: { length: "medium", concurrency: 2 },
      signal: new AbortController().signal,
      onEvent: () => {},
      includeOverview: false,
    });
    expect(outcome.status).toBe("sections");
    if (outcome.status !== "sections") return;
    const byId = Object.fromEntries(outcome.sections.map((r) => [r.id, r]));
    expect(byId["file:src/index.ts"].body).toBe("Revised narration for src/index.ts.");
    expect(byId["file:src/b.ts"].body).toBe("Draft narration for src/b.ts.");
    const revisions = calls.filter((m) => m.length === 4);
    expect(revisions).toHaveLength(plan.sections.length);
    // The draft is the assistant's own turn, and later parts hear about earlier ones.
    const second = revisions.find((m) => m[1].content.includes(`<file path="${(plan.sections[1] as { path: string }).path}">`))!;
    expect(second[2]).toMatchObject({ role: "assistant" });
    expect(second[3].content).toContain("<previous");
    expect(second[3].content).toMatch(/Already explained[\s\S]*how src\/index\.ts works/);
  });

  it("can skip the second look", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => reply(init));
    vi.stubGlobal("fetch", fetchMock);
    const ingest = demo();
    const plan = buildPlan(ingest);
    await runWalkthrough({
      ingest,
      plan,
      settings,
      options: { length: "medium", concurrency: 2, revise: false },
      signal: new AbortController().signal,
      onEvent: () => {},
      includeOverview: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(plan.sections.length);
  });

  it("stops everything on a bad key without blaming individual sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 })),
    );
    const ingest = demo();
    const events: PipelineEvent[] = [];
    const outcome = await runWalkthrough({
      ingest,
      plan: buildPlan(ingest),
      settings,
      options: { length: "medium", concurrency: 3 },
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(outcome).toMatchObject({ status: "failed", error: { kind: "auth" } });
    expect(events.some((e) => e.type === "section-failed")).toBe(false);
  });

  it("splits a part that is too long for the model and carries on", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        calls++;
        const user = JSON.parse(init.body as string).messages[1].content as string;
        if (user.includes("<file") && user.length > 9000 && user.includes("src/a.ts\">")) {
          return new Response(JSON.stringify({ error: { message: "This model's maximum context length is 4096 tokens" } }), { status: 400 });
        }
        return reply(init);
      }),
    );
    const ingest = demo();
    // Make one file big enough to need splitting.
    const a = ingest.files.find((f) => f.path === "src/a.ts")!;
    a.content = body(400);
    a.lines = 400;
    const outcome = await runWalkthrough({
      ingest,
      plan: buildPlan(ingest),
      settings,
      options: { length: "medium", concurrency: 1 },
      signal: new AbortController().signal,
      onEvent: () => {},
      includeOverview: false,
    });
    expect(outcome.status).toBe("sections");
    expect(calls).toBeGreaterThan(4);
  });
});

describe("stopping mid-file", () => {
  it("doesn't save half a long file as finished when the run ends on its second part", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const user = JSON.parse(init.body as string).messages[1].content as string;
        if (user.includes("You're writing part 2 of")) {
          return new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 });
        }
        return reply(init);
      }),
    );
    const ingest = demo();
    const a = ingest.files.find((f) => f.path === "src/a.ts")!;
    a.content = body(1400);
    a.lines = 1400;
    const plan = buildPlan(ingest);
    const events: PipelineEvent[] = [];
    const outcome = await runWalkthrough({
      ingest,
      plan,
      settings,
      options: { length: "medium", concurrency: 1 },
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      session: newSession(),
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error.kind).toBe("credits");
    expect(outcome.failed).toContain("file:src/a.ts");
    expect(events.some((e) => e.type === "section-done" && e.result.id === "file:src/a.ts")).toBe(false);
  });
});

describe("helpers", () => {
  it("trims a cut-off reply back to its last full sentence", () => {
    expect(endAtSentence("One whole sentence. Another full one. And then the")).toBe("One whole sentence. Another full one.");
    expect(endAtSentence("Complete.")).toBe("Complete.");
  });

  it("can't loop forever on a single enormous line", () => {
    const line = { index: 0, total: 1, startLine: 1, endLine: 1, text: "x".repeat(20000) };
    const once = halve(line)!;
    expect(once).toHaveLength(1);
    expect(once[0].text.length).toBeLessThan(5000);
    const again = halve(once[0])!;
    expect(halve(again[0])).toBeNull();
  });
});
