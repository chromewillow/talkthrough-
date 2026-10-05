import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGzip } from "node:zlib";
import { pack as tarPack } from "tar-stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IngestError, ingestRepo } from "@/lib/ingest/ingest";

const FILES: Record<string, string | Buffer> = {
  "README.md": "# Demo\nA tiny app.",
  ".gitignore": "secret-notes.md\n",
  "package.json": '{ "name": "demo", "main": "src/index.ts" }',
  "package-lock.json": "{}",
  "src/index.ts": 'import { greet } from "./greet";\nconsole.log(greet());',
  "src/greet.ts": 'export const greet = () => "hi";',
  "src/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  "src/blob.bin.ts": Buffer.from([0x00, 0x01, 0x02, 0x00]),
  "secret-notes.md": "do not read",
  "node_modules/left-pad/index.js": "module.exports = 1",
  "node_modules/left-pad/package.json": "{}",
  "packages/web/app.ts": "export const web = true;",
};

let server: Server;

// Thousands of folders, each with its own rule-heavy .gitignore: matching must stay cheap.
const IGNORES: Record<string, string> = {};
for (let i = 0; i < 1500; i++) {
  IGNORES[`pkg${i}/.gitignore`] = Array.from({ length: 40 }, (_, j) => `generated-${j}/**/*.tmp`).join("\n");
  IGNORES[`pkg${i}/index.ts`] = `export const n${i} = ${i};`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/me/ignores/tar.gz/")) {
      res.writeHead(200, { "Content-Type": "application/x-gzip" });
      const p = tarPack();
      for (const [name, body] of Object.entries(IGNORES)) p.entry({ name: `ignores-abc/${name}` }, body);
      p.finalize();
      p.pipe(createGzip()).pipe(res);
      return;
    }
    if (!req.url?.startsWith("/me/demo/tar.gz/")) {
      res.writeHead(404).end();
      return;
    }
    const ref = decodeURIComponent(req.url.slice("/me/demo/tar.gz/".length));
    if (ref !== "HEAD" && ref !== "main") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/x-gzip" });
    const p = tarPack();
    for (const [name, body] of Object.entries(FILES)) p.entry({ name: `demo-abc123/${name}` }, body);
    p.finalize();
    p.pipe(createGzip()).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.TALKTHROUGH_CODELOAD_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

describe("ingestRepo", () => {
  it("keeps source, skips noise, applies .gitignore and maps imports", async () => {
    const r = await ingestRepo("https://github.com/me/demo");
    const kept = r.files.map((f) => f.path).sort();
    expect(kept).toEqual(["README.md", "package.json", "packages/web/app.ts", "src/greet.ts", "src/index.ts"]);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]));
    expect(reasons).toMatchObject({
      "package-lock.json": "lockfile",
      "src/logo.png": "asset",
      "src/blob.bin.ts": "binary",
      "secret-notes.md": "gitignored",
      node_modules: "dependencies",
    });
    // A skipped folder is listed once, not file by file.
    expect(r.skipped.filter((s) => s.path.startsWith("node_modules"))).toHaveLength(1);
    const index = r.files.find((f) => f.path === "src/index.ts")!;
    expect(index.isEntry).toBe(true);
    expect(index.imports).toEqual(["src/greet.ts"]);
    expect(r.readmePath).toBe("README.md");
  });

  it("focuses on a subfolder from a /tree/ link", async () => {
    const r = await ingestRepo("github.com/me/demo/tree/main/packages/web");
    expect(r.repo.ref).toBe("main");
    expect(r.repo.subpath).toBe("packages/web");
    expect(r.files.map((f) => f.path)).toEqual(["app.ts"]);
  });

  it("caps ignore rules so a repo full of .gitignore files stays quick", async () => {
    const t = performance.now();
    const r = await ingestRepo("me/ignores");
    expect(performance.now() - t).toBeLessThan(8000);
    expect(r.files.length).toBeGreaterThan(1000);
  }, 20000);

  it("reports missing repositories in plain language", async () => {
    await expect(ingestRepo("github.com/me/nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(ingestRepo("github.com/me/nope")).rejects.toBeInstanceOf(IngestError);
  });
});
