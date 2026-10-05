// Stand-in for codeload.github.com during tests. Serves a gzipped tarball of
// $FIXTURES_DIR/<owner>__<repo> (any folder; a .git directory is skipped),
// wrapped in "<repo>-<ref>/" like GitHub does. Unknown repos get a 404.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, relative } from "node:path";
import { createGzip } from "node:zlib";
import { pack as tarPack } from "tar-stream";

const dir = process.env.FIXTURES_DIR ?? new URL("../fixtures", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4010);

function* walk(root, base = root) {
  for (const name of readdirSync(root)) {
    if (name === ".git") continue;
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, base);
    else if (st.isFile()) yield { path: relative(base, full), full };
  }
}

createServer((req, res) => {
  if (process.env.DEBUG_MOCK) console.log(req.method, req.url);
  const m = req.url.match(/^\/([^/]+)\/([^/]+)\/tar\.gz\/(.+)$/);
  const repoDir = m && join(dir, `${m[1]}__${m[2]}`);
  const ref = m && decodeURIComponent(m[3]);
  if (!m || !existsSync(repoDir) || !["HEAD", "main", "master"].includes(ref)) {
    res.writeHead(404).end("Not Found");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/x-gzip" });
  const p = tarPack();
  for (const f of walk(repoDir)) p.entry({ name: `${m[2]}-${ref}/${f.path}` }, readFileSync(f.full));
  p.finalize();
  p.pipe(createGzip()).pipe(res);
}).listen(port, () => console.log(`mock codeload on :${port} serving ${dir}`));
