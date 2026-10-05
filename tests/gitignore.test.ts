import { describe, expect, it } from "vitest";
import { GitignoreSet, LinguistHints } from "@/lib/ingest/gitignore";

describe("GitignoreSet", () => {
  it("applies nested rules relative to their folder, deepest last", () => {
    const g = new GitignoreSet();
    g.add(".gitignore", "*.log\nsecret/\n");
    g.add("web/.gitignore", "generated/\n!keep.log\n");
    expect(g.ignores("debug.log")).toBe(true);
    expect(g.ignores("secret/a.ts")).toBe(true);
    expect(g.ignores("web/generated/x.ts")).toBe(true);
    expect(g.ignores("generated/x.ts")).toBe(false);
    expect(g.ignores("web/keep.log")).toBe(false);
    expect(g.ignores("src/index.ts")).toBe(false);
  });
});

describe("LinguistHints", () => {
  it("flags linguist-generated and vendored paths", () => {
    const l = new LinguistHints();
    l.add(".gitattributes", "api/*.gen.ts linguist-generated=true\nthird_party/** linguist-vendored\n*.md text\n");
    expect(l.isGenerated("api/client.gen.ts")).toBe(true);
    expect(l.isGenerated("third_party/lib/a.js")).toBe(true);
    expect(l.isGenerated("README.md")).toBe(false);
  });
});
