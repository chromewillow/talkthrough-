import { describe, expect, it } from "vitest";
import { buildTree } from "@/lib/tree";

const f = (path: string) => ({ path, lines: 1, language: "TypeScript", category: "core" as const });

describe("buildTree", () => {
  it("nests, counts, sorts folders first and compacts single-child chains", () => {
    const root = buildTree([f("src/lib/deep/a.ts"), f("src/b.ts"), f("README.md")], [{ path: "node_modules", reason: "dependencies", isDir: true }]);
    expect(root.included).toBe(3);
    expect(root.skippedCount).toBe(1);
    expect(root.children.map((c) => c.name)).toEqual(["node_modules", "src", "README.md"]);
    const src = root.children[1];
    expect(src.kind === "dir" && src.children.map((c) => c.name)).toEqual(["lib/deep", "b.ts"]);
  });
});
