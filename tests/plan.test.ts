import { describe, expect, it } from "vitest";
import { analyzeFiles } from "@/lib/ingest/analyze";
import type { IngestResult } from "@/lib/ingest/types";
import { buildPlan, chunkContent, isTrivial } from "@/lib/narrate/plan";
import { coreTerms, collectDeps } from "@/lib/narrate/prompts";
import { sentenceCase } from "@/lib/narrate/pipeline";

const lines = (n: number, prefix = "const x") => Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i};`).join("\n");

function ingestOf(files: Record<string, string>): IngestResult {
  const analyzed = analyzeFiles(Object.entries(files).map(([path, content]) => ({ path, size: content.length, content })));
  return {
    repo: { owner: "me", repo: "demo", ref: "HEAD", subpath: "", htmlUrl: "https://github.com/me/demo" },
    files: analyzed,
    skipped: [],
    readmePath: analyzed.find((f) => f.path === "README.md") ? "README.md" : null,
    stats: { totalEntries: 0, includedFiles: analyzed.length, includedBytes: 0, skippedEntries: 0, unlistedSkipped: 0 },
    notes: [],
  };
}

describe("buildPlan", () => {
  const ingest = ingestOf({
    "README.md": "# Demo",
    "package.json": '{ "dependencies": { "next": "16" } }',
    "tsconfig.json": "{}",
    "app/layout.tsx": `import "./globals.css";\n${lines(40)}`,
    "app/page.tsx": `import { Hero } from "@/components/hero";\n${lines(60)}`,
    "app/globals.css": ":root {\n  --accent: gold;\n}\nbody {\n  color: var(--accent);\n}",
    "components/hero.tsx": `import { Button } from "@/components/ui/button";\n${lines(80)}`,
    "components/ui/button.tsx": lines(30),
    "components/ui/input.tsx": lines(30),
    "components/ui/dialog.tsx": lines(30),
    "components/ui/card.tsx": lines(30),
    "lib/db.ts": lines(120),
    "lib/index.ts": 'export * from "./db";',
    "lib/utils.ts": lines(20),
    "tests/page.test.ts": lines(20),
  });
  const plan = buildPlan(ingest, "medium");
  const ids = plan.sections.map((s) => s.id);

  it("starts with entry points and ends with config and tests", () => {
    expect(ids[0]).toBe("file:app/layout.tsx");
    expect(ids[1]).toBe("file:app/page.tsx");
    expect(ids.indexOf("group:config")).toBeGreaterThan(ids.indexOf("file:lib/db.ts"));
    expect(ids[ids.length - 1]).toBe("group:tests");
  });

  it("groups minor files and skips the README and trivial barrels", () => {
    expect(ids).toContain("group:ui-kit");
    expect(ids).toContain("group:styles");
    expect(ids).not.toContain("file:README.md");
    expect(ids).not.toContain("file:lib/index.ts");
    expect(plan.omitted).toContain("lib/index.ts");
  });

  it("gives substantial central files a full section", () => {
    const db = plan.sections.find((s) => s.id === "file:lib/db.ts");
    expect(db?.kind === "file" && db.depth).toBe("full");
    const utils = plan.sections.find((s) => s.id === "file:lib/utils.ts");
    expect(utils?.kind === "file" && utils.depth).toBe("brief");
  });
});

describe("tour order and chapters", () => {
  it("plays components in the order the app reaches them and assigns chapters", () => {
    const ingest = ingestOf({
      "package.json": '{ "dependencies": { "react": "19", "redux": "5" } }',
      "src/main.jsx": `import { App } from "./App";\n${lines(10)}`,
      "src/App.jsx": `import { Zeta } from "./components/Zeta";\nimport { Alpha } from "./components/Alpha";\n${lines(60)}`,
      "src/components/Zeta.jsx": `import { Inner } from "./Inner";\n${lines(70)}`,
      "src/components/Inner.jsx": lines(70),
      "src/components/Alpha.jsx": lines(70),
    });
    const plan = buildPlan(ingest);
    const order = plan.sections.map((s) => s.id);
    expect(order.indexOf("file:src/components/Zeta.jsx")).toBeLessThan(order.indexOf("file:src/components/Inner.jsx"));
    expect(order.indexOf("file:src/components/Inner.jsx")).toBeLessThan(order.indexOf("file:src/components/Alpha.jsx"));
    expect(order.slice(0, 2)).toEqual(["file:src/main.jsx", "file:src/App.jsx"]);
    expect(plan.sections[0].chapter).toBe("start");
    expect(plan.sections.find((s) => s.id === "file:src/components/Alpha.jsx")?.chapter).toBe("interface");
    expect(plan.sections.find((s) => s.id === "group:config")?.chapter).toBe("setup");
    expect(coreTerms(collectDeps(ingest.files))).toEqual(["component", "props", "state", "hook", "store", "action", "reducer", "middleware"]);
  });

  it("only defines hooks and server components when the code uses them", () => {
    const classic = ingestOf({
      "package.json": '{ "dependencies": { "react": "16", "next": "9" } }',
      "pages/index.jsx": `export default class Home extends React.Component {}\n${lines(10)}`,
    });
    expect(coreTerms(collectDeps(classic.files), classic.files)).toEqual(["component", "props", "state", "route"]);
    const modern = ingestOf({
      "package.json": '{ "dependencies": { "react": "19", "next": "16" } }',
      "app/page.tsx": `export default function Page() { const [a] = useState(0); return a }\n${lines(10)}`,
    });
    expect(coreTerms(collectDeps(modern.files), modern.files)).toEqual(["component", "props", "state", "hook", "route", "server component"]);
  });

  it("puts over-capitalised titles into sentence case", () => {
    expect(sentenceCase("The Article Editor Form")).toBe("The article editor form");
    expect(sentenceCase("How the API route talks to OpenAI")).toBe("How the API route talks to OpenAI");
    expect(sentenceCase("Where React Router fits")).toBe("Where React Router fits");
  });
});

describe("section ids", () => {
  it("stays unique when one folder has small files in two tiers", () => {
    const ingest = ingestOf({
      "src/main.ts": `import "./lib/db";\n${lines(40)}`,
      "src/lib/db.ts": lines(20),
      "src/lib/auth.ts": lines(20),
      "src/lib/api.ts": lines(20),
      "src/lib/utils.ts": lines(20),
      "src/lib/types.ts": lines(20),
      "src/lib/constants.ts": lines(20),
    });
    const ids = buildPlan(ingest).sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("chunkContent", () => {
  it("leaves short files whole and splits long ones at top-level boundaries", () => {
    expect(chunkContent("a\nb", 100)).toHaveLength(1);
    const text = Array.from({ length: 40 }, (_, i) => `function f${i}() {\n  return ${i};\n}\n`).join("\n");
    const chunks = chunkContent(text, 300);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.text).join("\n")).toBe(text);
    for (const c of chunks.slice(1)) expect(c.text.startsWith("function")).toBe(true);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[1].startLine).toBe(chunks[0].endLine + 1);
  });
});

describe("isTrivial", () => {
  const f = (content: string) => ({ content }) as Parameters<typeof isTrivial>[0];
  it("spots empty markers and re-export barrels only", () => {
    expect(isTrivial(f(""))).toBe(true);
    expect(isTrivial(f('"""Package."""\n'))).toBe(true);
    expect(isTrivial(f('export * from "./a";\nexport { b, c } from "./b";\nexport type { T } from "./t";'))).toBe(true);
    expect(isTrivial(f("from .core import run\nfrom .util import helper\n__all__ = [\n  'run',\n  'helper',\n]"))).toBe(true);
    expect(isTrivial(f("export function add(a, b) {\n  return a + b;\n}\n"))).toBe(false);
  });
});
