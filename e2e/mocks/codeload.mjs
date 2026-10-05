// Stand-in for codeload.github.com during tests: serves `git archive`
// tarballs of local clones found in $FIXTURES_DIR/<owner>__<repo>.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const dir = process.env.FIXTURES_DIR ?? "/home/user/fixtures";
const port = Number(process.env.PORT ?? 4010);

createServer((req, res) => {
  if (process.env.DEBUG_MOCK) console.log(req.method, req.url);
  const m = req.url.match(/^\/([^/]+)\/([^/]+)\/tar\.gz\/(.+)$/);
  const repoDir = m && join(dir, `${m[1]}__${m[2]}`);
  if (!m || !existsSync(repoDir)) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const ref = decodeURIComponent(m[3]);
  let sha;
  try {
    sha = execFileSync("git", ["-C", repoDir, "rev-parse", "--verify", `${ref}^{commit}`]).toString().trim();
  } catch {
    res.writeHead(404).end("Not Found");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/x-gzip" });
  const git = spawn("git", ["-C", repoDir, "archive", "--format=tar.gz", `--prefix=${m[2]}-${sha.slice(0, 7)}/`, sha]);
  git.stdout.pipe(res);
}).listen(port, () => console.log(`mock codeload on :${port}`));
