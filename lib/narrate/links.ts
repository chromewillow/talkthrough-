/**
 * Finds the code on the other side of a file's hand-offs, so a narrator can
 * state what happens there instead of guessing. Two files are linked when one
 * imports the other, or when they share a rare name: an action type, a storage
 * key, a state field, an event or a setting that only a few files mention.
 * Only the lines that mention the shared names are shown, which keeps the
 * excerpts small enough to send with every part.
 */
import type { RepoFile } from "@/lib/ingest/types";

/** Kinds of file whose names are worth matching across the codebase. */
const CODE_CATEGORIES = new Set(["entry", "route", "core", "component", "helper", "script"]);

const SCREAMING = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const CAMEL = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b/g;
// Quoted keys: storage keys, field names, event names. Kebab-case is left out
// because it's almost always a CSS class.
const QUOTED_KEY = /["'`]([a-z][a-z0-9]*(?:_[a-z0-9]+)*)["'`]/g;

/** Platform and framework names every file shares; they say nothing about this app. */
const COMMON = new Set(
  (
    "useState useEffect useRef useMemo useCallback useContext useReducer useRouter useParams useSearchParams useLayoutEffect " +
    "componentDidMount componentWillMount componentWillUnmount componentDidUpdate componentWillReceiveProps shouldComponentUpdate " +
    "getDerivedStateFromProps mapStateToProps mapDispatchToProps setState forceUpdate defaultProps propTypes displayName " +
    "preventDefault stopPropagation addEventListener removeEventListener getElementById querySelector querySelectorAll " +
    "createElement appendChild innerHTML textContent className htmlFor tabIndex autoFocus readOnly defaultValue onClick " +
    "onChange onSubmit onBlur onFocus onKeyDown dangerouslySetInnerHTML toString toLowerCase toUpperCase forEach indexOf " +
    "localStorage sessionStorage setTimeout clearTimeout setInterval clearInterval requestAnimationFrame getItem setItem removeItem " +
    "parseInt parseFloat isArray hasOwnProperty startsWith endsWith padStart toFixed getTime toISOString fromEntries " +
    "createContext createStore applyMiddleware combineReducers getState createSlice configureStore createAsyncThunk " +
    "useSelector useDispatch useNavigate useLocation " +
    "async await isNaN encodeURIComponent decodeURIComponent"
  ).split(/\s+/),
);

/** Quoted words too generic to link two files. */
const COMMON_KEYS = new Set(
  (
    "client server strict utf8 text button submit div span none auto true false null get post put patch delete " +
    "application json form input string number object function default index error errors data name title value " +
    "type key click change react next node path image email password username"
  ).split(" "),
);

export type LinkIndex = {
  /** Rare names each file mentions. */
  names: Map<string, Set<string>>;
  /** Files that mention each rare name. */
  holders: Map<string, string[]>;
  files: Map<string, RepoFile>;
};

function namesIn(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(SCREAMING)) if (m[0].length >= 5) out.add(m[0]);
  for (const m of content.matchAll(CAMEL)) if (m[0].length >= 6 && !COMMON.has(m[0])) out.add(m[0]);
  for (const m of content.matchAll(QUOTED_KEY)) {
    const k = m[1];
    if (k.length < 3 || k.length > 40 || COMMON_KEYS.has(k)) continue;
    if (/class(Name)?\s*=\s*\{?\s*$/.test(content.slice(Math.max(0, m.index - 14), m.index))) continue;
    out.add(k);
  }
  return out;
}

export function buildLinkIndex(files: RepoFile[]): LinkIndex {
  const code = files.filter((f) => CODE_CATEGORIES.has(f.category));
  const raw = new Map(code.map((f) => [f.path, namesIn(f.content)]));
  const counts = new Map<string, string[]>();
  for (const [path, set] of raw) for (const n of set) counts.set(n, [...(counts.get(n) ?? []), path]);
  // A name is rare when only a handful of files mention it.
  const maxHolders = Math.min(12, Math.max(5, Math.ceil(code.length * 0.03)));
  const holders = new Map([...counts].filter(([, list]) => list.length >= 2 && list.length <= maxHolders));
  const names = new Map<string, Set<string>>();
  for (const [path, set] of raw) names.set(path, new Set([...set].filter((n) => holders.has(n))));
  return { names, holders, files: new Map(files.map((f) => [f.path, f])) };
}

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}

/** Names a file makes available to others: its exports and its own base name. */
function exportedNames(f: RepoFile): string[] {
  const out = new Set<string>();
  const base = baseName(f.path);
  if (base !== "index" && /^[A-Za-z_$][\w$]*$/.test(base)) out.add(base);
  else if (base === "index") {
    const dir = f.path.split("/").slice(-2, -1)[0];
    if (dir && /^[A-Za-z_$][\w$]*$/.test(dir)) out.add(dir);
  }
  for (const m of f.content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of f.content.matchAll(/export\s*\{([^}]{1,400})\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") out.add(name);
    }
  }
  // Python and Go: top-level definitions.
  for (const m of f.content.matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)|^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)) {
    out.add(m[1] ?? m[2] ?? m[3]);
  }
  return [...out].filter((n) => n.length >= 3 && !COMMON.has(n));
}

const IMPORT_LINE = /^\s*(import\b|from\s+\S+\s+import\b|export\s+\{[^}]*\}\s+from\b|export\s+\*\s+from\b|(const|let|var)\s+[\w{}\s,]+=\s*require\()/;

/**
 * The lines of a file that mention any of the given names, with a little
 * context either side, joined with gaps marked. Import lines are skipped:
 * they say a connection exists, which the narrator already knows.
 */
export function excerptLines(content: string, names: string[], maxChars: number, around = 2): string {
  if (!names.length) return "";
  const escaped = names.map((n) => n.replace(/[$.*+?^(){}[\]|\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\w$])(?:${escaped.join("|")})(?![\\w$])`);
  const lines = content.split("\n");
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.length > 400 || IMPORT_LINE.test(line) || !re.test(line)) return;
    for (let j = Math.max(0, i - around); j <= Math.min(lines.length - 1, i + around); j++) keep.add(j);
  });
  const out: string[] = [];
  let size = 0;
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const line = lines[i];
    if (IMPORT_LINE.test(line)) continue;
    const piece = (i !== last + 1 && out.length ? "…\n" : "") + line;
    if (size + piece.length + 1 > maxChars) {
      out.push("…");
      break;
    }
    out.push(piece);
    size += piece.length + 1;
    last = i;
  }
  return out.join("\n").trim();
}

const CONSTANT_LINE = /^(export\s+)?(const|let|var|final|static)?\s*[A-Za-z_$][\w$]*\s*[:=]\s*(['"`][^'"`]*['"`]|-?\d[\d_.]*|true|false|None|null)\s*[,;]?$/;

/**
 * A file that is mostly a list of named constants, like every action type in
 * the app. Its lines just repeat the names, so it makes a poor excerpt.
 */
export function isRegistry(f: RepoFile): boolean {
  const lines = f.content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(\/\/|#|\/\*|\*)/.test(l));
  if (lines.length < 8) return false;
  return lines.filter((l) => CONSTANT_LINE.test(l)).length / lines.length > 0.6;
}

export type RelatedExcerpt = { path: string; why: string; text: string };

type Candidate = { path: string; score: number; names: Set<string>; why: string[] };

/**
 * Up to a handful of linked files for one file, best first, each with the
 * lines that matter. Hub files that share names with half the codebase, like
 * a list of every action type, are ranked down: their lines are just the list.
 */
export function relatedExcerpts(
  index: LinkIndex,
  path: string,
  { maxFiles = 5, perFile = 1200, total = 5000 }: { maxFiles?: number; perFile?: number; total?: number } = {},
): RelatedExcerpt[] {
  const self = index.files.get(path);
  if (!self) return [];
  const candidates = new Map<string, Candidate>();
  const add = (p: string, score: number, names: string[], why: string) => {
    if (p === path || !index.files.has(p)) return;
    const c = candidates.get(p) ?? { path: p, score: 0, names: new Set<string>(), why: [] };
    c.score += score;
    names.forEach((n) => c.names.add(n));
    if (!c.why.includes(why)) c.why.push(why);
    candidates.set(p, c);
  };

  const mine = index.names.get(path) ?? new Set<string>();
  for (const name of mine) {
    // The rarer the name, the stronger the link: two files sharing a state
    // field beat six files sharing a common action.
    const holders = index.holders.get(name) ?? [];
    for (const other of holders) add(other, 4 / holders.length, [name], "shares names with this file");
  }
  const selfExports = exportedNames(self);
  for (const p of self.importedBy) add(p, 1, selfExports, "uses this file");
  for (const p of self.imports) {
    const dep = index.files.get(p);
    if (!dep) continue;
    const used = exportedNames(dep).filter((n) => new RegExp(`(?<![\\w$])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(self.content));
    add(p, 1.5, used, "is used by this file");
  }

  const ranked = [...candidates.values()]
    .map((c) => ({ ...c, score: isRegistry(index.files.get(c.path)!) ? c.score * 0.2 : c.score }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const out: RelatedExcerpt[] = [];
  let used = 0;
  let primary = 0;
  let hops = 0;
  for (const c of ranked) {
    if (primary >= maxFiles || used >= total) break;
    const file = index.files.get(c.path)!;
    const text = excerptLines(file.content, [...c.names], Math.min(perFile, total - used));
    if (!text) continue;
    const shared = [...c.names].filter((n) => mine.has(n)).slice(0, 4);
    const why = c.why.join("; ") + (shared.length ? ` (${shared.join(", ")})` : "");
    out.push({ path: c.path, why, text });
    used += text.length;
    primary++;

    // One hop further: where a linked file gets registered, such as a reducer
    // added to the combined store under a key the rest of the app reads.
    // Only logic files get registered somewhere worth showing; a component's importer just renders it.
    const direct = self.imports.includes(c.path) || self.importedBy.includes(c.path);
    if (!direct && (file.category === "core" || file.category === "helper") && hops < 2 && used < total) {
      const registrar = file.importedBy.find((p) => p !== path && !out.some((o) => o.path === p));
      const reg = registrar ? index.files.get(registrar) : undefined;
      if (reg) {
        const hop = excerptLines(reg.content, exportedNames(file), Math.min(400, total - used), 1);
        if (hop) {
          out.push({ path: reg.path, why: `brings in ${c.path}`, text: hop });
          used += hop.length;
          hops++;
        }
      }
    }
  }
  return out;
}
