/**
 * Static, best-effort understanding of a repository without running it:
 * what language each file is in, what role it plays, which files import
 * which, and where the app starts. This drives narration order — the goal is
 * a sensible tour, not a compiler-grade dependency graph.
 */
import type { FileCategory, RepoFile } from "./types";
import { basenameOf, extensionOf } from "./filters";

type RawFile = { path: string; size: number; content: string };

// ─── Languages ──────────────────────────────────────────────────────────────

const EXT_LANGUAGE: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript + React",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript + React",
  mjs: "JavaScript",
  cjs: "JavaScript",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  py: "Python",
  ipynb: "Jupyter notebook",
  rb: "Ruby",
  erb: "Ruby template",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin script",
  scala: "Scala",
  swift: "Swift",
  m: "Objective-C",
  mm: "Objective-C++",
  c: "C",
  h: "C header",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++ header",
  hh: "C++ header",
  cs: "C#",
  fs: "F#",
  php: "PHP",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  clj: "Clojure",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  zig: "Zig",
  sol: "Solidity",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  styl: "Stylus",
  pcss: "PostCSS",
  md: "Markdown",
  mdx: "MDX",
  rst: "reStructuredText",
  txt: "Text",
  json: "JSON",
  jsonc: "JSON",
  json5: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "INI",
  cfg: "Config",
  conf: "Config",
  xml: "XML",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  ps1: "PowerShell",
  bat: "Batch",
  sql: "SQL",
  prisma: "Prisma schema",
  graphql: "GraphQL",
  gql: "GraphQL",
  proto: "Protocol Buffers",
  tf: "Terraform",
  hcl: "HCL",
  nix: "Nix",
  gradle: "Gradle",
  liquid: "Liquid",
  jinja: "Jinja template",
  jinja2: "Jinja template",
  j2: "Jinja template",
  mustache: "Mustache template",
  hbs: "Handlebars",
  ejs: "EJS template",
  pug: "Pug",
  njk: "Nunjucks",
  twig: "Twig",
};

const NAME_LANGUAGE: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  procfile: "Procfile",
  gemfile: "Ruby",
  rakefile: "Ruby",
  justfile: "Justfile",
  vagrantfile: "Ruby",
  brewfile: "Ruby",
};

export function languageOf(path: string): string {
  const base = basenameOf(path).toLowerCase();
  if (NAME_LANGUAGE[base]) return NAME_LANGUAGE[base];
  if (base.startsWith("dockerfile")) return "Dockerfile";
  return EXT_LANGUAGE[extensionOf(path)] ?? "Text";
}

const CODE_EXTS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro", "py", "ipynb",
  "rb", "go", "rs", "java", "kt", "scala", "swift", "m", "mm", "c", "h", "cc", "cpp", "cxx",
  "hpp", "hh", "cs", "fs", "php", "dart", "ex", "exs", "erl", "hs", "clj", "lua", "r", "jl",
  "zig", "sol", "sh", "bash", "zsh", "ps1", "sql", "prisma", "graphql", "gql", "proto",
]);

const JS_EXTS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro"];

// ─── Categories ─────────────────────────────────────────────────────────────

const CONFIG_NAMES = new Set([
  "package.json", "jsconfig.json", "components.json", "vercel.json", "netlify.toml",
  "wrangler.toml", "wrangler.json", "wrangler.jsonc", "fly.toml", "render.yaml", "railway.json",
  "railway.toml", "app.json", "eas.json", "turbo.json", "nx.json", "lerna.json",
  "pnpm-workspace.yaml", "biome.json", "biome.jsonc", "deno.json", "deno.jsonc", "bunfig.toml",
  "renovate.json", ".editorconfig", ".browserslistrc", ".babelrc", "pyproject.toml", "setup.py",
  "setup.cfg", "pipfile", "tox.ini", "pytest.ini", "mypy.ini", ".flake8", "ruff.toml",
  ".ruff.toml", "cargo.toml", "go.mod", "go.work", "gemfile", "rakefile", "composer.json",
  "pubspec.yaml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
  "gradle.properties", "pom.xml", "makefile", "justfile", "procfile", "docker-compose.yml",
  "docker-compose.yaml", "compose.yml", "compose.yaml", ".gitlab-ci.yml", "firebase.json",
  ".firebaserc", "manifest.json", "site.webmanifest", "serverless.yml", "serverless.yaml",
  "nodemon.json", "vite-env.d.ts", "env.d.ts", "global.d.ts", "babel.config.json",
  "capacitor.config.json", "ionic.config.json", "angular.json", "nest-cli.json",
  "requirements.txt", "requirements-dev.txt", "dev-requirements.txt", "runtime.txt",
  "environment.yml", "conda.yaml", "mkdocs.yml", "vercel.ts", "codecov.yml", ".coveragerc",
  ".pre-commit-config.yaml", ".releaserc", ".releaserc.json", "project.json", "workspace.json",
  "drizzle.config.json", "sst.config.ts", "dependabot.yml", "dockerfile",
]);

/** Names like `next.config.ts`, `tailwind.config.js`, `.eslintrc.cjs`, `tsconfig.app.json`. */
const CONFIG_PATTERNS: RegExp[] = [
  /^[\w-]+\.config\.(js|cjs|mjs|ts|cts|mts|json|jsonc|yaml|yml|toml)$/,
  /^\.?[\w-]+rc(\.(js|cjs|mjs|ts|json|jsonc|yaml|yml|toml))?$/,
  /^tsconfig([.\w-]*)\.json$/,
  /^dockerfile(\.[\w-]+)?$/,
  /^[\w.-]+\.dockerfile$/,
  /^\.env\.(example|sample|template|dist|defaults?)$/,
  /^docker-compose[.\w-]*\.ya?ml$/,
  /^requirements[\w.-]*\.(txt|in)$/,
];

function isConfig(path: string): boolean {
  const base = basenameOf(path).toLowerCase();
  if (CONFIG_NAMES.has(base)) return true;
  if (CONFIG_PATTERNS.some((re) => re.test(base))) return true;
  if (/^(\.github|\.circleci|\.husky|\.devcontainer|\.changeset|\.storybook|\.cursor|\.claude)\//.test(path)) {
    // .storybook holds config code; .changeset holds release notes — both minor.
    return true;
  }
  if (/(^|\/)(terraform|infra|deploy|deployment|k8s|kubernetes|helm|charts|\.platform)\//.test(path)) {
    return /\.(tf|hcl|ya?ml|json|toml)$/.test(base);
  }
  return false;
}

const TEST_PATTERNS: RegExp[] = [
  /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright|__mocks__|mocks|fixtures|testdata|test-utils|testing)\//i,
  /\.(test|spec|e2e|stories|story|cy)\.[\w]+$/i,
  /_test\.(go|py|rb|exs|dart)$/i,
  /(^|\/)test_[\w-]+\.py$/i,
  /(^|\/)conftest\.py$/i,
  /Tests?\.(java|kt|cs|swift)$/,
];

const TEMPLATE_EXTS = new Set(["html", "htm", "liquid", "hbs", "handlebars", "ejs", "pug", "njk", "twig", "erb", "jinja", "jinja2", "j2", "mustache", "blade"]);
const DOC_EXTS = new Set(["md", "mdx", "rst", "txt", "adoc", "markdown"]);
const STYLE_EXTS = new Set(["css", "scss", "sass", "less", "styl", "pcss"]);
const DATA_EXTS = new Set(["json", "jsonc", "json5", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf", "properties", "plist", "csv"]);

function dirSegments(path: string): string[] {
  return path.split("/").slice(0, -1).map((s) => s.toLowerCase());
}

function hasDir(path: string, names: string[]): boolean {
  const segs = dirSegments(path);
  return segs.some((s) => names.includes(s));
}

type ProjectHints = {
  deps: Set<string>;
};

function categorize(path: string, hints: ProjectHints): FileCategory {
  const base = basenameOf(path);
  const lower = base.toLowerCase();
  const ext = extensionOf(path);

  if (TEST_PATTERNS.some((re) => re.test(path))) return "test";
  if (isConfig(path)) return "config";
  if (DOC_EXTS.has(ext) || /(^|\/)docs?\//i.test(path)) {
    return CODE_EXTS.has(ext) ? "helper" : "docs";
  }
  if (STYLE_EXTS.has(ext) || /\.css\.(ts|js)$/.test(lower)) return "style";
  if ((hasDir(path, ["scripts", "script", "bin"]) && !hasDir(path, ["src", "lib", "app"])) || /^(tools|tooling)\//i.test(path)) {
    return "script";
  }
  if (["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"].includes(ext)) return "script";
  if (hasDir(path, ["migrations", "migration", "seeds", "seeders"])) return "data";

  // Routes and pages: the surface of the app.
  if (isRouteFile(path, hints)) return "route";

  if (DATA_EXTS.has(ext)) {
    // Settings files at the top of the project are configuration, not data.
    return !path.includes("/") || lower.startsWith(".") || /^taskfile\./.test(lower) ? "config" : "data";
  }
  // Browser scripts served as static files belong with the interface.
  if (hasDir(path, ["static", "public", "assets", "www"]) && CODE_EXTS.has(ext)) return "component";
  if (TEMPLATE_EXTS.has(ext)) return "component";

  if (
    hasDir(path, ["utils", "util", "helpers", "helper", "hooks", "composables", "common", "shared", "constants", "types", "typings", "@types", "interfaces"]) ||
    /\.d\.ts$/.test(lower) ||
    /^(utils?|helpers?|constants?|types?|consts?|enums?|config)\.[\w]+$/.test(lower) ||
    /^use[A-Z][\w]*\.(t|j)sx?$/.test(base)
  ) {
    return "helper";
  }

  if (
    ["vue", "svelte", "astro"].includes(ext) ||
    hasDir(path, ["components", "component", "ui", "widgets", "layouts", "partials", "templates", "icons"])
  ) {
    return "component";
  }

  if (ext === "tsx" || ext === "jsx") {
    // React files outside the obvious folders are usually components,
    // unless they live with the app's core logic.
    if (!hasDir(path, ["lib", "core", "services", "store", "stores", "state", "context", "providers", "server"])) {
      return "component";
    }
  }

  if (CODE_EXTS.has(ext) || ext === "") return "core";
  return "data";
}

function isRouteFile(path: string, hints: ProjectHints): boolean {
  const lower = path.toLowerCase();
  const base = basenameOf(lower);
  const ext = extensionOf(lower);
  if (!CODE_EXTS.has(ext) && !["html"].includes(ext)) return false;

  // Next.js App Router special files.
  if (/(^|\/)app\//.test(lower) && /^(page|layout|route|loading|error|not-found|template|default|global-error|middleware|opengraph-image|sitemap|robots)\.[\w]+$/.test(base)) {
    return true;
  }
  // Expo Router: every screen under app/ is a route.
  if (hints.deps.has("expo-router") && /(^|\/)app\//.test(lower) && /\.(t|j)sx?$/.test(base)) return true;
  // Next.js Pages Router, Nuxt, Astro, SvelteKit, Remix.
  if (/(^|\/)(pages|routes)\//.test(lower) && !/(^|\/)(components|lib|utils)\//.test(lower)) return true;
  if (/(^|\/)src\/routes\//.test(lower)) return true;
  if (/(^|\/)server\/(api|routes)\//.test(lower)) return true;
  // Classic server folders.
  if (/(^|\/)(api|controllers?|handlers|endpoints|resolvers|views|screens)\//.test(lower)) return true;
  if (/^(routes?|router|urls|views|endpoints|controllers?)\.[\w]+$/.test(base)) return true;
  if (/\.(controller|routes?|router|handler|resolver|endpoint)\.[\w]+$/.test(base)) return true;
  return false;
}

// ─── Entry points ───────────────────────────────────────────────────────────

const ENTRY_NAMES = [
  /^(main|index|app|server|cli|run|start|bot|worker|wsgi|asgi|manage|program|bootstrap)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|dart|php|swift|ex|exs)$/i,
  /^__main__\.py$/,
  /^app\.(vue|svelte)$/i,
];

function isEntryByPath(path: string, hints: ProjectHints, allPaths: Set<string>): boolean {
  const base = basenameOf(path);
  const segs = path.split("/");
  const depth = segs.length - 1;
  const parent = (segs[segs.length - 2] ?? "").toLowerCase();

  // Next.js root layout / home page and the Pages Router app shell.
  if (/^(src\/)?app\/(layout|page)\.(t|j)sx?$/.test(path)) return true;
  if (/^(src\/)?pages\/(_app|index)\.(t|j)sx?$/.test(path)) return true;
  if (hints.deps.has("next") && /^(src\/)?(middleware|proxy)\.(t|j)s$/.test(path)) return true;
  if (hints.deps.has("expo-router") && /^(src\/)?app\/_layout\.(t|j)sx?$/.test(path)) return true;
  // Rust and Go conventions.
  if (/^src\/(main|lib)\.rs$/.test(path)) return true;
  if (/^cmd\/[^/]+\/main\.go$/.test(path) || path === "main.go") return true;
  if (/^lib\/main\.dart$/.test(path)) return true;
  if (base === "__main__.py" && depth <= 2) return true;
  // Python's src layout: src/<package>/main.py, src/<package>/app.py.
  if (depth === 2 && segs[0] === "src" && /^(main|app|server|cli)\.py$/.test(base)) return true;
  // Root-level main / index / app / server files, or one folder down in src/app/server.
  if (ENTRY_NAMES.some((re) => re.test(base))) {
    if (depth === 0) return true;
    if (depth === 1 && ["src", "app", "server", "backend", "api", "lib", "cmd", "bin"].includes(parent)) {
      // `lib/index.ts` is only an entry when there's no src/ entry to prefer.
      if (parent === "lib" && [...allPaths].some((p) => /^src\/(main|index)\./.test(p))) return false;
      return true;
    }
  }
  return false;
}

// ─── Imports ────────────────────────────────────────────────────────────────

// Every repetition is bounded, so a crafted file can't make these scans quadratic.
const JS_IMPORT_RE =
  /(?:^|[^\w$.])(?:import|export)\s[^'"`;]{0,400}?\sfrom\s*['"]([^'"\n]{1,300})['"]|(?:^|[^\w$.])import\s*['"]([^'"\n]{1,300})['"]|(?:^|[^\w$.])require\(\s*['"]([^'"\n]{1,300})['"]\s*\)|(?:^|[^\w$.])import\(\s*['"]([^'"\n]{1,300})['"]\s*\)/g;
const CSS_IMPORT_RE = /@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"\n]{1,300})['"]/g;
const PY_IMPORT_RE = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;
const PY_FROM_RE = /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^()]{0,4000}\)|[^\n#]+)/gm;
const GO_IMPORT_BLOCK_RE = /import\s*\(([^()]{0,8000})\)/g;
const GO_IMPORT_LINE_RE = /import\s+(?:[\w.]+\s+)?"([^"]+)"/g;
const RUBY_REQUIRE_RE = /require(_relative)?\s*(?:\(\s*)?['"]([^'"\n]{1,300})['"]/g;
const RUST_MOD_RE = /^\s*(?:pub(?:\([\w:]+\))?\s+)?mod\s+(\w+)\s*;/gm;
const RUST_USE_RE = /^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm;
const C_INCLUDE_RE = /^\s*#\s*include\s+"([^"]+)"/gm;
const PHP_INCLUDE_RE = /(?:require|include)(?:_once)?\s*(?:\(\s*)?(?:__DIR__\s*\.\s*)?['"]([^'"\n]{1,300}\.php)['"]/g;
const PHP_USE_RE = /^\s*use\s+([\w\\]+)\s*;/gm;
const JVM_IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;?/gm;
const DART_IMPORT_RE = /^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/gm;

function normalize(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function join(dir: string, rel: string): string | null {
  return normalize(dir ? `${dir}/${rel}` : rel);
}

type Resolver = {
  paths: Set<string>;
  /** Path aliases, each scoped to the folder of the tsconfig that declared it ("" for defaults). */
  aliases: { prefix: string; targets: string[]; scope: string; fallback?: boolean }[];
  baseUrls: string[];
  goModule: string | null;
  goDirs: Map<string, string[]>;
  pyRoots: string[];
  psr4: { prefix: string; dir: string }[];
  jvmByStem: Map<string, string[]>;
  dartPackage: string | null;
};

const JS_RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro", ".json", ".css", ".scss"];

function resolveJsLike(base: string, r: Resolver): string | null {
  const candidates: string[] = [];
  for (const ext of JS_RESOLVE_EXTS) candidates.push(base + ext);
  for (const ext of JS_RESOLVE_EXTS.slice(1)) candidates.push(`${base}/index${ext}`);
  // TS ESM style: `import "./x.js"` that really points at x.ts.
  const swapped = base.match(/^(.*)\.(m|c)?jsx?$/);
  if (swapped) for (const ext of [".ts", ".tsx", ".mts", ".cts"]) candidates.push(swapped[1] + ext);
  for (const c of candidates) if (r.paths.has(c)) return c;
  return null;
}

function resolveJsSpecifier(from: string, spec: string, r: Resolver): string | null {
  const clean = spec.split("?")[0];
  if (clean.startsWith("./") || clean.startsWith("../") || clean === "." || clean === "..") {
    const joined = join(dirOf(from), clean);
    return joined === null ? null : resolveJsLike(joined, r);
  }
  if (clean.startsWith("/")) {
    const joined = normalize(clean);
    return joined ? resolveJsLike(joined, r) : null;
  }
  // In a monorepo each package has its own aliases: use the nearest tsconfig's first.
  const inScope = (scope: string) => !scope || from.startsWith(`${scope}/`);
  const applicable = r.aliases
    .filter((a) => a.fallback || inScope(a.scope))
    .sort((a, b) => Number(a.fallback ?? false) - Number(b.fallback ?? false) || b.scope.length - a.scope.length || b.prefix.length - a.prefix.length);
  for (const { prefix, targets } of applicable) {
    if (clean === prefix || clean.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || (prefix.endsWith("/") && clean.startsWith(prefix))) {
      const rest = clean.slice(prefix.length).replace(/^\//, "");
      for (const t of targets) {
        const joined = normalize(t ? `${t}/${rest}` : rest);
        const hit = joined !== null ? resolveJsLike(joined, r) : null;
        if (hit) return hit;
      }
    }
  }
  for (const b of r.baseUrls) {
    const joined = normalize(b ? `${b}/${clean}` : clean);
    const hit = joined !== null ? resolveJsLike(joined, r) : null;
    if (hit) return hit;
  }
  return null;
}

function resolvePyModule(from: string, mod: string, r: Resolver): string[] {
  const dots = mod.match(/^\.*/)?.[0].length ?? 0;
  const name = mod.slice(dots).replace(/\./g, "/");
  const bases: string[] = [];
  if (dots > 0) {
    let dir = dirOf(from);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    bases.push(dir);
  } else {
    bases.push(...r.pyRoots);
  }
  const hits: string[] = [];
  for (const b of bases) {
    const p = name ? (b ? `${b}/${name}` : name) : b;
    for (const c of [`${p}.py`, `${p}/__init__.py`]) {
      const n = normalize(c);
      if (n && r.paths.has(n)) {
        hits.push(n);
        break;
      }
    }
  }
  return hits;
}

function extractImports(file: RawFile, r: Resolver): string[] {
  const ext = extensionOf(file.path);
  const text = file.content;
  const found = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (p && p !== file.path) found.add(p);
  };

  if (JS_EXTS.includes(ext) || ext === "html") {
    for (const m of text.matchAll(JS_IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (spec) add(resolveJsSpecifier(file.path, spec, r));
    }
    if (ext === "html") {
      // Vite-style apps: <script type="module" src="/src/main.tsx">, rooted at the HTML file's folder.
      for (const m of text.matchAll(/<(?:script|link)\b[^<>]{1,500}?(?:src|href)=["']([^"':]{1,300})["']/g)) {
        const joined = join(dirOf(file.path), m[1].replace(/^\//, ""));
        if (joined !== null) add(resolveJsLike(joined, r));
      }
    }
  } else if (STYLE_EXTS.has(ext)) {
    for (const m of text.matchAll(CSS_IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith("http")) continue;
      const rel = spec.startsWith(".") ? spec : `./${spec}`;
      const joined = join(dirOf(file.path), rel);
      if (!joined) continue;
      const partial = joined.replace(/([^/]+)$/, "_$1");
      for (const c of [joined, `${joined}.css`, `${joined}.scss`, `${partial}.scss`, `${joined}.less`]) {
        if (r.paths.has(c)) {
          add(c);
          break;
        }
      }
    }
  } else if (ext === "py" || ext === "ipynb") {
    for (const m of text.matchAll(PY_IMPORT_RE)) {
      for (const mod of m[1].split(",")) for (const hit of resolvePyModule(file.path, mod.trim(), r)) add(hit);
    }
    for (const m of text.matchAll(PY_FROM_RE)) {
      const mod = m[1];
      const names = m[2].replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
      const modHits = mod.replace(/\./g, "") ? resolvePyModule(file.path, mod, r) : [];
      modHits.forEach(add);
      // `from . import views` / `from pkg import submodule`
      for (const n of names) {
        if (!/^\w+$/.test(n)) continue;
        const sep = mod.endsWith(".") ? "" : ".";
        for (const hit of resolvePyModule(file.path, `${mod}${sep}${n}`, r)) add(hit);
      }
    }
  } else if (ext === "go") {
    const specs: string[] = [];
    for (const m of text.matchAll(GO_IMPORT_BLOCK_RE)) for (const q of m[1].matchAll(/"([^"]+)"/g)) specs.push(q[1]);
    for (const m of text.matchAll(GO_IMPORT_LINE_RE)) specs.push(m[1]);
    if (r.goModule) {
      for (const s of specs) {
        if (!s.startsWith(r.goModule + "/")) continue;
        const dir = s.slice(r.goModule.length + 1);
        for (const p of r.goDirs.get(dir) ?? []) add(p);
      }
    }
  } else if (ext === "rb") {
    for (const m of text.matchAll(RUBY_REQUIRE_RE)) {
      const spec = m[2].endsWith(".rb") ? m[2] : `${m[2]}.rb`;
      const roots = m[1] ? [dirOf(file.path)] : ["lib", "app", ""];
      for (const root of roots) {
        const c = join(root, spec);
        if (c && r.paths.has(c)) {
          add(c);
          break;
        }
      }
    }
  } else if (ext === "rs") {
    const base = basenameOf(file.path);
    const modDir = /^(main|lib|mod)\.rs$/.test(base) ? dirOf(file.path) : file.path.replace(/\.rs$/, "");
    for (const m of text.matchAll(RUST_MOD_RE)) {
      for (const c of [`${modDir}/${m[1]}.rs`, `${modDir}/${m[1]}/mod.rs`]) {
        const n = normalize(c);
        if (n && r.paths.has(n)) {
          add(n);
          break;
        }
      }
    }
    for (const m of text.matchAll(RUST_USE_RE)) {
      const parts = m[1].split("::").filter(Boolean);
      for (let i = parts.length; i > 0; i--) {
        const p = `src/${parts.slice(0, i).join("/")}`;
        const hit = [`${p}.rs`, `${p}/mod.rs`].find((c) => r.paths.has(c));
        if (hit) {
          add(hit);
          break;
        }
      }
    }
  } else if (["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm"].includes(ext)) {
    for (const m of text.matchAll(C_INCLUDE_RE)) {
      for (const root of [dirOf(file.path), "include", "src", ""]) {
        const c = normalize(root ? `${root}/${m[1]}` : m[1]);
        if (c && r.paths.has(c)) {
          add(c);
          break;
        }
      }
    }
  } else if (ext === "php") {
    for (const m of text.matchAll(PHP_INCLUDE_RE)) {
      const c = join(dirOf(file.path), m[1].replace(/^\//, ""));
      if (c && r.paths.has(c)) add(c);
    }
    for (const m of text.matchAll(PHP_USE_RE)) {
      const fq = m[1];
      for (const { prefix, dir } of r.psr4) {
        if (!fq.startsWith(prefix)) continue;
        const c = normalize(`${dir}/${fq.slice(prefix.length).replace(/\\/g, "/")}.php`);
        if (c && r.paths.has(c)) add(c);
      }
    }
  } else if (["java", "kt", "scala"].includes(ext)) {
    for (const m of text.matchAll(JVM_IMPORT_RE)) {
      const parts = m[1].split(".");
      const stem = parts[parts.length - 1];
      const suffix = parts.join("/");
      for (const p of r.jvmByStem.get(stem) ?? []) {
        if (p.replace(/\.(java|kt|scala)$/, "").endsWith(suffix)) add(p);
      }
    }
  } else if (ext === "dart") {
    for (const m of text.matchAll(DART_IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith("dart:")) continue;
      if (spec.startsWith("package:")) {
        if (r.dartPackage && spec.startsWith(`package:${r.dartPackage}/`)) {
          const c = `lib/${spec.slice(`package:${r.dartPackage}/`.length)}`;
          if (r.paths.has(c)) add(c);
        }
      } else {
        const c = join(dirOf(file.path), spec);
        if (c && r.paths.has(c)) add(c);
      }
    }
  }
  return [...found];
}

// ─── Project hints ──────────────────────────────────────────────────────────

/** Parses JSON with comments and trailing commas (tsconfig style). */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += ch;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

function buildResolver(files: RawFile[]): { resolver: Resolver; hints: ProjectHints; packageJsons: { path: string; json: Record<string, unknown> }[] } {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const aliases: Resolver["aliases"] = [];
  const baseUrls: string[] = [];
  const deps = new Set<string>();
  const packageJsons: { path: string; json: Record<string, unknown> }[] = [];

  for (const f of files) {
    const base = basenameOf(f.path);
    if (base === "package.json") {
      const json = parseJsonc(f.content) as Record<string, unknown> | null;
      if (json && typeof json === "object") {
        packageJsons.push({ path: f.path, json });
        for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
          const d = json[key];
          if (d && typeof d === "object") Object.keys(d).forEach((k) => deps.add(k));
        }
      }
    }
    if (/^(tsconfig|jsconfig)(\.[\w-]+)?\.json$/.test(base)) {
      const json = parseJsonc(f.content) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | null;
      const co = json?.compilerOptions;
      if (!co) continue;
      const dir = dirOf(f.path);
      const baseUrl = normalize(join(dir, co.baseUrl ?? ".") ?? dir) ?? "";
      if (co.baseUrl) baseUrls.push(baseUrl);
      for (const [key, targets] of Object.entries(co.paths ?? {})) {
        if (!Array.isArray(targets)) continue;
        const prefix = key.replace(/\*$/, "");
        aliases.push({
          prefix,
          scope: dir,
          targets: targets.map((t) => normalize(join(baseUrl, String(t).replace(/\*$/, "")) ?? "") ?? "").filter((t) => t !== null),
        });
      }
    }
  }
  // Common aliases even without a tsconfig (Vite, Nuxt, SvelteKit conventions), tried last.
  aliases.push({ prefix: "@/", targets: ["src", ""], scope: "", fallback: true });
  aliases.push({ prefix: "~/", targets: ["src", "app", ""], scope: "", fallback: true });
  aliases.push({ prefix: "$lib/", targets: ["src/lib"], scope: "", fallback: true });

  // Go module path.
  let goModule: string | null = null;
  const goMod = byPath.get("go.mod");
  if (goMod) goModule = goMod.content.match(/^module\s+(\S+)/m)?.[1] ?? null;
  const goDirs = new Map<string, string[]>();
  for (const p of paths) {
    if (!p.endsWith(".go") || p.endsWith("_test.go")) continue;
    const d = dirOf(p);
    goDirs.set(d, [...(goDirs.get(d) ?? []), p]);
  }

  // Python import roots: repo root, src/, and folders that hold a setup/pyproject.
  const pyRoots = [""];
  if ([...paths].some((p) => p.startsWith("src/") && p.endsWith(".py"))) pyRoots.push("src");
  for (const p of paths) {
    if (/(^|\/)(pyproject\.toml|setup\.py)$/.test(p) && dirOf(p)) pyRoots.push(dirOf(p), `${dirOf(p)}/src`);
  }

  // PHP PSR-4 autoload.
  const psr4: Resolver["psr4"] = [];
  const composer = byPath.get("composer.json");
  if (composer) {
    const json = parseJsonc(composer.content) as { autoload?: { "psr-4"?: Record<string, string | string[]> } } | null;
    for (const [prefix, dir] of Object.entries(json?.autoload?.["psr-4"] ?? {})) {
      for (const d of Array.isArray(dir) ? dir : [dir]) psr4.push({ prefix, dir: d.replace(/\/$/, "") });
    }
  }

  const jvmByStem = new Map<string, string[]>();
  for (const p of paths) {
    const m = basenameOf(p).match(/^(\w+)\.(java|kt|scala)$/);
    if (m) jvmByStem.set(m[1], [...(jvmByStem.get(m[1]) ?? []), p]);
  }

  const pubspec = byPath.get("pubspec.yaml");
  const dartPackage = pubspec?.content.match(/^name:\s*([\w_]+)/m)?.[1] ?? null;

  return {
    resolver: { paths, aliases, baseUrls, goModule, goDirs, pyRoots, psr4, jvmByStem, dartPackage },
    hints: { deps },
    packageJsons,
  };
}

/** Files that package.json, index.html or pyproject say are the starting point. */
function declaredEntries(files: RawFile[], r: Resolver, packageJsons: { path: string; json: Record<string, unknown> }[]): Set<string> {
  const entries = new Set<string>();
  const tryAdd = (dir: string, spec: unknown) => {
    if (typeof spec !== "string" || !spec) return;
    const joined = join(dir, spec.replace(/^\.\//, ""));
    const hit = joined === null ? null : resolveJsLike(joined, r);
    if (hit) entries.add(hit);
  };

  for (const { path, json } of packageJsons) {
    const dir = dirOf(path);
    tryAdd(dir, json.main);
    tryAdd(dir, json.module);
    const bin = json.bin;
    if (typeof bin === "string") tryAdd(dir, bin);
    else if (bin && typeof bin === "object") Object.values(bin).forEach((b) => tryAdd(dir, b));
    const exp = json.exports;
    if (typeof exp === "string") tryAdd(dir, exp);
    const scripts = json.scripts as Record<string, string> | undefined;
    for (const key of ["start", "dev", "serve"]) {
      const cmd = scripts?.[key];
      if (typeof cmd !== "string") continue;
      for (const m of cmd.matchAll(/(?:^|\s)((?:\.\/)?[\w./-]+\.(?:js|mjs|cjs|ts|mts|py))(?=\s|$)/g)) tryAdd(dir, m[1]);
    }
  }

  for (const f of files) {
    if (basenameOf(f.path) !== "index.html") continue;
    for (const m of f.content.matchAll(/<script[^>]{1,500}?src=["']([^"':]{1,300})["']/g)) {
      const spec = m[1].replace(/^\//, "");
      tryAdd(dirOf(f.path), spec);
    }
  }

  // pyproject [project.scripts]: name = "pkg.module:func"
  for (const f of files) {
    if (basenameOf(f.path) !== "pyproject.toml") continue;
    const block = f.content.match(/\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?:\n\[|$)/);
    if (!block) continue;
    for (const m of block[1].matchAll(/=\s*["']([\w.]+):/g)) {
      for (const hit of resolvePyModule(f.path, m[1], r)) entries.add(hit);
    }
  }
  return entries;
}

// ─── Importance ─────────────────────────────────────────────────────────────

const CATEGORY_WEIGHT: Record<FileCategory, number> = {
  entry: 30,
  route: 18,
  core: 16,
  component: 12,
  helper: 6,
  script: 2,
  style: 1,
  config: 0,
  data: -6,
  test: -10,
  docs: -10,
};

const NAME_SIGNAL =
  /(^|[/_.-])(app|main|index|server|router|routes|store|state|db|database|schema|models?|auth|session|api|client|service|engine|core|context|provider|pipeline|agent|prompt|workflow|handler|controller|actions?)([/_.-]|$)/i;

function importanceOf(f: Omit<RepoFile, "importance" | "content">): number {
  let score = CATEGORY_WEIGHT[f.category];
  if (f.isEntry) score += 40;
  score += Math.min(36, f.importedBy.length * 6);
  const surface = f.category === "route" || f.isEntry;
  score += Math.min(surface ? 24 : 14, f.imports.length * 2);
  if (f.category === "route" && /(^|\/)api\//.test(f.path) && f.lines > 60) score += 8;
  if (f.lines >= 20) score += 8;
  else if (f.lines < 8) score -= 6;
  // Substantial files carry more of the app's behaviour.
  if (f.lines > 60) score += Math.min(12, Math.round(Math.log2(f.lines / 60) * 4));
  const depth = f.path.split("/").length - 1;
  score -= Math.max(0, depth - 2) * 2;
  if (NAME_SIGNAL.test(f.path)) score += 4;
  return score;
}

// ─── Public entry ───────────────────────────────────────────────────────────

const IMPORT_BUDGET_MS = 5000;

export function analyzeFiles(raw: RawFile[]): RepoFile[] {
  const { resolver, hints, packageJsons } = buildResolver(raw);
  const declared = declaredEntries(raw, resolver, packageJsons);

  // Import scanning is the one step whose cost depends on what's inside files;
  // past a time budget the rest go without import links rather than stall the server.
  const started = Date.now();
  const importsByPath = new Map<string, string[]>();
  for (const f of raw) importsByPath.set(f.path, Date.now() - started < IMPORT_BUDGET_MS ? extractImports(f, resolver) : []);
  const importedBy = new Map<string, string[]>();
  for (const [from, list] of importsByPath) {
    for (const to of list) {
      const users = importedBy.get(to);
      if (users) users.push(from);
      else importedBy.set(to, [from]);
    }
  }

  // A "script" the app itself imports (an agent's tools folder, say) is app code,
  // and so is anything such a file imports in turn.
  const categories = new Map(raw.map((f) => [f.path, categorize(f.path, hints)] as const));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [path, category] of categories) {
      if (category === "script" && (importedBy.get(path) ?? []).some((p) => categories.get(p) !== "script")) {
        categories.set(path, "core");
        changed = true;
      }
    }
  }

  const files: RepoFile[] = raw.map((f) => {
    let category = categories.get(f.path)!;
    const isEntry =
      category !== "test" &&
      category !== "config" &&
      category !== "docs" &&
      (declared.has(f.path) || isEntryByPath(f.path, hints, resolver.paths));
    if (isEntry) category = "entry";
    const partial = {
      path: f.path,
      size: f.size,
      lines: f.content.split("\n").length,
      language: languageOf(f.path),
      category,
      isEntry,
      imports: importsByPath.get(f.path) ?? [],
      importedBy: importedBy.get(f.path) ?? [],
    };
    return { ...partial, importance: importanceOf(partial), content: f.content };
  });

  return files;
}

export function findReadme(paths: string[]): string | null {
  const candidates = paths
    .filter((p) => /^readme(\.(md|markdown|mdx|rst|txt))?$/i.test(basenameOf(p)))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
  return candidates[0] ?? null;
}
