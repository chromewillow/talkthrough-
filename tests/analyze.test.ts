import { describe, expect, it } from "vitest";
import { analyzeFiles, findReadme, parseJsonc } from "@/lib/ingest/analyze";

const file = (path: string, content = "") => ({ path, size: content.length || 10, content: content || "// x\n" });

describe("analyzeFiles", () => {
  it("resolves TypeScript imports, aliases and index files", () => {
    const files = analyzeFiles([
      file("tsconfig.json", '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } } // comment'),
      file("package.json", '{ "dependencies": { "next": "16" } }'),
      file("app/page.tsx", 'import { Button } from "@/components/button";\nimport x from "../lib";\nimport { y } from "./helpers.js";'),
      file("app/helpers.ts", "export const y = 1;"),
      file("components/button.tsx", "export function Button() {}"),
      file("lib/index.ts", "export default 1;"),
    ]);
    const page = files.find((f) => f.path === "app/page.tsx")!;
    expect(page.imports.sort()).toEqual(["app/helpers.ts", "components/button.tsx", "lib/index.ts"]);
    expect(page.isEntry).toBe(true);
    expect(files.find((f) => f.path === "components/button.tsx")!.importedBy).toEqual(["app/page.tsx"]);
    expect(files.find((f) => f.path === "components/button.tsx")!.category).toBe("component");
    expect(files.find((f) => f.path === "tsconfig.json")!.category).toBe("config");
  });

  it("resolves Python absolute and relative imports", () => {
    const files = analyzeFiles([
      file("src/pkg/__init__.py", "from .core import run"),
      file("src/pkg/core.py", "from pkg.util import helper\nfrom . import models"),
      file("src/pkg/util.py", "def helper(): pass"),
      file("src/pkg/models.py", "class M: pass"),
      file("src/pkg/__main__.py", "import pkg.core"),
    ]);
    const core = files.find((f) => f.path === "src/pkg/core.py")!;
    expect(core.imports.sort()).toEqual(["src/pkg/models.py", "src/pkg/util.py"]);
    expect(files.find((f) => f.path === "src/pkg/__main__.py")!.isEntry).toBe(true);
  });

  it("resolves Go packages through go.mod", () => {
    const files = analyzeFiles([
      file("go.mod", "module github.com/me/tool\n\ngo 1.22"),
      file("main.go", 'package main\n\nimport (\n  "fmt"\n  "github.com/me/tool/ui"\n)'),
      file("ui/ui.go", "package ui"),
      file("ui/ui_test.go", "package ui"),
    ]);
    const main = files.find((f) => f.path === "main.go")!;
    expect(main.imports).toEqual(["ui/ui.go"]);
    expect(main.isEntry).toBe(true);
    expect(files.find((f) => f.path === "ui/ui_test.go")!.category).toBe("test");
  });

  it("finds Vite entries from index.html and categorises tests", () => {
    const files = analyzeFiles([
      file("index.html", '<script type="module" src="/src/main.tsx"></script>'),
      file("src/main.tsx", 'import App from "./App";'),
      file("src/App.tsx", "export default function App() {}"),
      file("src/App.test.tsx", 'import App from "./App";'),
    ]);
    expect(files.find((f) => f.path === "src/main.tsx")!.isEntry).toBe(true);
    expect(files.find((f) => f.path === "src/App.test.tsx")!.category).toBe("test");
  });
});

describe("helpers", () => {
  it("parses JSON with comments and trailing commas", () => {
    expect(parseJsonc('{ // hi\n "a": "http://x", /* c */ "b": [1,], }')).toEqual({ a: "http://x", b: [1] });
  });
  it("prefers the shallowest README", () => {
    expect(findReadme(["docs/README.md", "README.md", "src/a.ts"])).toBe("README.md");
  });
});
