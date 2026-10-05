# Talkthrough

**Hear what your code is actually doing.**

Talkthrough turns any public GitHub repository into a plain-English walkthrough written to be *listened to*. Paste a repo link and you get back a calm, spoken-style tour of the code — what each part does, why it's there, how it connects to the rest, and where you'd go to change it. Paste the script into ElevenLabs (or any text-to-speech app) and listen while you walk, cook or commute.

It's made for people who build with AI — vibe coders — who want to genuinely understand what's in their app so they can add or remove features with confidence.

Talkthrough doesn't generate audio itself. The output is text.

## How to use it

1. Open the app and paste a GitHub link — `github.com/owner/repo`, a `.git` URL, or a link to a branch or folder (`…/tree/main/apps/web`) all work.
2. Open **Model & key** and add your API key. OpenRouter is the default (`https://openrouter.ai/api/v1`, model `anthropic/claude-sonnet-5.5`), but any OpenAI-compatible endpoint works: set the base URL, key and model name.
3. Press **Generate walkthrough** and watch it read the repo and explain each file.
4. Press **Copy script** and paste it into ElevenLabs. Long scripts are best in ElevenLabs Studio. You can also download a `.txt` (the listening script) or a `.md` (with headings and file paths, for reading along).

If a run stops part-way — a rate limit, a flaky connection, or you pressed Stop — press **Resume**. Finished parts are kept, so you don't pay for them twice.

## What happens under the hood

1. **Ingest.** The server downloads the repository as a single tarball from GitHub and filters it the way [gitingest](https://github.com/coderamp-labs/gitingest) does: it skips dependencies, build output, caches, lockfiles, images, fonts, media, binaries, minified and generated code, likely secrets (`.env`, keys), anything matched by the repo's own `.gitignore` files, and anything `.gitattributes` marks as generated or vendored. It then works out each file's language and role, finds the entry points, and maps which files import which (JS/TS, Python, Go, Rust, Ruby, PHP, Java/Kotlin, Dart, C/C++, CSS).
2. **Plan.** Files are ordered into a tour — entry points and the app shell first, then routes and core logic, components and helpers — with minor files grouped: configuration, tests, styles, docs, UI kits, migrations, and runs of small sibling files. The most central files get a full section; small ones get a short mention. Very large files are split at natural boundaries.
3. **Explain.** Each section goes to your model with the repo's context (README, file tree, what imports what) and instructions written for the ear: no code read aloud, no symbols or markdown, names said the way a person says them, and always the *why* and *where to change it*.
4. **Overview and closing.** The model then writes a big-picture introduction from all the section summaries — what the app is, its main parts, how data and actions flow — and a closing guide to where you'd go to make the most likely changes.
5. **Assemble.** Everything becomes one script: overview, the parts in tour order, then the closing guide. A final pass strips anything a voice would stumble over.

## Your API key

- The key is kept in your browser only (in `localStorage` if "Remember on this device" is on, otherwise in memory).
- Requests go straight from your browser to your provider. Talkthrough's server never sees them.
- Some providers refuse requests from browsers. When that happens, requests automatically go through `/api/llm`, a small stateless relay on this site that forwards the request and streams the answer back. It never logs or stores the key or the content, and it refuses to connect to local or private network addresses.

## Run it yourself

```bash
npm install
npm run dev        # http://localhost:3000
```

```bash
npm test           # unit and integration tests (vitest)
npm run typecheck
npm run lint
npm run build
```

Optional environment variables:

| Variable | What it does |
| --- | --- |
| `TALKTHROUGH_GITHUB_TOKEN` | A GitHub token for the server to download repositories through the authenticated API (higher limits; the groundwork for private repos). Not needed for public repos. |
| `TALKTHROUGH_CODELOAD_BASE` | Point repository downloads at another server — used by tests with a local stand-in for GitHub. |
| `TALKTHROUGH_RELAY_ALLOW_HTTP` | Set to `1` to let the relay reach plain `http://` endpoints (it already does in development). |

### Testing without real services

```bash
npm run test:e2e   # builds the app and runs the browser tests
```

The end-to-end tests run a production build against two stand-ins: `e2e/mocks/codeload.mjs` serves the sample app in `e2e/fixtures/` as if it were a GitHub tarball, and `e2e/mocks/llm.mjs` is a fake OpenAI-compatible provider (key `good-key`; models `missing`, `broke`, `slow` and `flaky` exercise the error paths; `CORS=0` makes it refuse browser requests so the relay kicks in). If Playwright can't find a browser, point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at a Chromium binary.

To click around by hand against the same stand-ins:

```bash
PORT=4010 node e2e/mocks/codeload.mjs
PORT=4011 node e2e/mocks/llm.mjs
TALKTHROUGH_CODELOAD_BASE=http://localhost:4010 npm run dev
# then use github.com/demo/notes-app, base URL http://localhost:4011/v1, key good-key
```

## Deploy

Talkthrough is a standard Next.js app and deploys to Vercel with no configuration and no environment variables. Import this repository at [vercel.com/new](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Fchromewillow%2Ftalkthrough-) and press Deploy; after that, every push to `main` deploys automatically. The ingest route runs for up to 60 seconds and the relay for up to 300.

To make your own copy instead:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fchromewillow%2Ftalkthrough-)

## Project layout

```
app/
  page.tsx                 the single page
  api/ingest/route.ts      downloads and filters a repository
  api/llm/route.ts         optional relay for providers that block browsers
components/
  talkthrough/             the app: form, settings, progress, result, backdrop
  ui/                      shadcn/ui components, restyled
lib/
  github/                  URL parsing and tarball download
  ingest/                  filters, .gitignore, analysis (roles, imports, entry points)
  narrate/                 plan, prompts, model client, pipeline, assembly
  client/                  browser-side state, settings and history
tests/                     vitest suites
e2e/                       browser tests, a sample app to narrate, and
                           stand-ins for GitHub and a model provider
```

## Built to grow

Some things are deliberately left for later, with room made for them in the code:

- **Narration length** — short, medium and long budgets already exist in `lib/narrate/plan.ts`; only the picker is missing.
- **Sending the script straight to ElevenLabs** — the assembled script is a plain string from `lib/narrate/assemble.ts`, ready to hand to a text-to-speech API.
- **Private repositories** — the downloader already supports an authenticated GitHub token (`fetchRepoArchive({ token })`).
