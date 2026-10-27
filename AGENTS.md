# AGENTS.md — Book Video Studio

Instructions for AI coding agents and contributors. Source of truth for product behavior is
[`BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md`](./BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md) (Vietnamese). When this file and the
requirements disagree on product behavior, the requirements win; when they disagree on engineering practice, this file wins.

## 1. Project snapshot

Local-first, single-user app (Windows + WSL2) that turns an imported book (`.txt`/`.md`) into **short-form vertical videos**
(9:16, for TikTok / YouTube Shorts / Facebook Reels). Pipeline: Book → Chapter → Lesson (AI analysis) → Video → Scenes →
Vietnamese voiceover → Remotion render.

Hard constraints (do not relax without an explicit user decision):

- **Stack is fixed:** Next.js App Router + TypeScript strict, Tailwind CSS, shadcn/ui, Zod, Prisma + SQLite, BullMQ + Redis,
  standalone Node.js worker, Remotion. **No NestJS, no microservices, no cloud infra.** One repo, one web process, one worker process.
- **No Anthropic API / SDK / API key**, ever. AI runs through `MockAiProvider` or the user's own Claude Code CLI (see §9).
- **Short-form only:** 9:16, final 1080×1920 / draft 720×1280, 30 FPS, H.264 + AAC, ≤ 90 s (default 60 s). No 16:9, no long videos.
- **Vietnamese (vi-VN)** for UI copy, scripts, narration, on-screen text and captions. Code, identifiers, file names: English.
- **Localhost only** (`127.0.0.1`). No auth, no multi-user, no public exposure.
- **Low-resource machine:** worker concurrency = 1, Remotion render concurrency = 1 until benchmarked on the real machine.

## 2. Commands

**Package manager: pnpm only.** Never run `npm` or `yarn`, never commit another lockfile. `packageManager` is pinned in `package.json`.

| Task                                       | Command                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| Install deps (also runs `prisma generate`) | `pnpm install`                                       |
| Start Redis (Docker, recommended)          | `docker compose up -d`                               |
| Apply migrations / create DB               | `pnpm db:migrate`                                    |
| Regenerate Prisma client                   | `pnpm db:generate`                                   |
| Seed demo data                             | `pnpm db:seed`                                       |
| Web dev server (127.0.0.1:3000)            | `pnpm dev`                                           |
| Worker (watch mode)                        | `pnpm worker:dev`                                    |
| Worker (no watch)                          | `pnpm worker:start`                                  |
| Run a real-AI task from the terminal (M5)  | `pnpm ai:run --job <jobId>`                          |
| Environment diagnostics                    | `pnpm diagnose`                                      |
| Remotion Studio (inspect compositions)     | `pnpm remotion:studio`                               |
| Lint / format check / typecheck            | `pnpm lint` · `pnpm format:check` · `pnpm typecheck` |
| Tests                                      | `pnpm test` (`pnpm test:watch` while developing)     |
| Production build                           | `pnpm build`                                         |

First-time setup: `cp .env.example .env` → `pnpm install` → `docker compose up -d` → `pnpm db:migrate` → `pnpm db:seed`.
Run for development in three terminals: Redis, `pnpm worker:dev`, `pnpm dev`.

Toolchain notes (pinned on purpose — do not bump blindly):

- `pnpm doctor` is a pnpm built-in and shadows scripts of that name; the project script is `pnpm diagnose`.
- Prisma is pinned to **7.10.1** (npm `latest` for the CLI is an 8.0 release candidate). Config lives in `prisma.config.ts`; the SQLite URL is not in `schema.prisma`.
- TypeScript is pinned to **6.0.3** and ESLint to **9.x** until `typescript-eslint` / `eslint-config-next` plugins support TS 7 / ESLint 10.
- After editing `prisma/schema.prisma`: `pnpm db:migrate --name <short_description>`, commit the generated migration.
- Runtime path resolution (`process.cwd()` + data dir) carries `/* turbopackIgnore: true */` to stop Turbopack from tracing the whole project; keep it on new runtime-path code.
- The block at the bottom of this file between `BEGIN:nextjs-agent-rules` / `END:nextjs-agent-rules` is maintained by `next dev`; leave it alone.

**Quality gate before reporting any task done:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass.
Never claim something "works" unless it was actually executed; list what was not verified.

## 3. Architecture & process model

```
Browser ──► Next.js (UI + thin route handlers/server actions)
                │  validate (Zod) → feature service → repository → SQLite (Prisma)
                │  enqueue (BullMQ, IDs only) ───────────► Redis  `studio-jobs`
                ▼                                              │
            returns 202 { jobId, status }                      ▼
                                                      Worker (Node, separate process, concurrency 1)
                                                      ├─ Claude Code CLI task flow / MockAiProvider
                                                      ├─ edge-tts / uploaded audio + ffprobe
                                                      └─ Remotion renderer + FFmpeg  → data/videos/…
```

- Next.js never waits for AI/TTS/render inside an HTTP request. It enqueues and returns `202`; the UI polls `GET /api/jobs/:id` every 2–3 s.
- Rendering, Claude CLI and TTS run **only in the worker**. Never start worker logic from a route handler.
- BullMQ/Redis is the runtime source of truth for job execution; `JobRecord` (SQLite) is the read model / audit trail. Reconcile on restart.
- Web must not crash when Redis or the worker is down; it shows a degraded state. The worker must fail loudly (exit 1) if Redis is unreachable.

## 4. Code map

```
src/
  app/                 App Router: pages, layouts, thin API routes (runtime = 'nodejs' when touching fs/Redis)
    (studio)/          Studio pages: books, videos, jobs, settings (+ shell layout); most are placeholders until M1+
    api/               health, diagnostics/test-job, jobs/[jobId]  (more from M1+)
  components/
    ui/                shadcn/ui generated components (do not hand-edit beyond theming)
    layout/            App shell, sidebar navigation, page placeholder
  features/            Feature-first modules; layers created on first use:
                         domain/ (pure, framework-free rules — client-safe), schemas/ (Zod input + *.dto.ts types),
                         services/ (business logic), repositories/ (Prisma), components/ (React)
    books/             import parser (domain/), staging + immutable original/chapter files, import wizard, library/detail UI
    chapters/          chapter listing, reading and rename; analysis status labels
    lessons/ videos/   README only until M2–M4
    jobs/              job payload schemas, JobRecord repository, job service (enqueue/get), "run test job" button
  lib/                 client-safe helpers: utils.ts (shadcn `cn()`), api-client.ts (typed fetch + ApiError), format.ts (vi-VN)
  server/              Server-side infrastructure (never imported by client components or Remotion)
    db/                client.ts: Prisma + better-sqlite3 singleton, WAL setup (shared by Next, worker, scripts)
    queue/             constants, redis-connection.ts (shared: connection factories, probe, redaction), queue.ts (Next-only producer)
    storage/           DATA_DIR resolution (paths.ts), safe-path guard, atomic writes
    ai/                AiProvider interface, MockAiProvider, LocalCliTaskProvider (stub), contracts/ (Zod I/O schemas)
    diagnostics/       health checks aggregated for /settings, /api/health and `pnpm diagnose`
    http/              route-helpers.ts (AppError → JSON, readJson/parseInput with Zod), page-helpers.ts (orNotFound)
  worker/              Standalone process: main.ts, processors/ (dispatcher + one per job type), lifecycle/ (heartbeat, shutdown)
  remotion/            Pure React video code: index.ts (registerRoot), root.tsx, compositions/, theme/ (scenes/ and components/ arrive in M4)
  shared/              Truly shared: config/env.ts (Zod-validated env), logger.ts, errors.ts, types/ (create schemas/ on first need)
  generated/           Prisma client output (gitignored)
prisma/                schema.prisma, migrations/ (committed), seed.ts
scripts/               CLI entrypoints: run-claude-task.ts, diagnose.ts
tests/                 Vitest tests (unit/, integration/ …)
data/                  Runtime data (gitignored): studio.db, books/, ai-tasks/, videos/, diagnostics/
```

Where does new code go?

| I need to add…                     | Put it in…                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A page                             | `src/app/(studio)/<route>/page.tsx`; keep it orchestration-only                                                              |
| An API endpoint                    | `src/app/api/.../route.ts`: parse → call a service → map result/error. No business logic                                     |
| Pure rules / parsing (no I/O)      | `src/features/<feature>/domain/` — unit-test it directly                                                                     |
| Business logic                     | `src/features/<feature>/services/`                                                                                           |
| Database access                    | `src/features/<feature>/repositories/` (Prisma queries live here, nowhere else)                                              |
| Input/output validation            | `src/features/<feature>/schemas/*.schema.ts` (Zod); DTO types for client components in `schemas/*.dto.ts`                    |
| A new job type                     | processor in `src/worker/processors/`, register in `processors/index.ts`, add a Zod payload schema, add to the job-type list |
| Infra adapter (queue, fs, AI, TTS) | `src/server/<area>/`                                                                                                         |
| A video scene / layout             | `src/remotion/scenes/` (props only, no data access)                                                                          |
| A shadcn component                 | `pnpm dlx shadcn@latest add <name>` → `src/components/ui/`                                                                   |
| Env variable                       | `.env.example` + `src/shared/config/env.ts` (Zod) — never read `process.env` elsewhere                                       |

## 5. Layering & import boundaries

Dependency direction: `app → features/*/services → features/*/repositories → server/db`. Components never skip layers.

- Client components **must not** import Prisma, Redis/BullMQ, `fs`, `child_process`, or anything under `src/server/`.
- `src/remotion/**` must not import `src/server/**`, `src/features/**` services/repositories, or touch `process.env`, SQLite or Redis. It receives validated JSON props only.
- **`server-only` and the worker:** the `server-only` package throws outside Next's bundler. Anything the worker or `scripts/**` (run via `tsx`)
  imports — `server/db/client.ts`, `server/queue/redis-connection.ts`, `server/storage/*`, `features/*/repositories/*`, `shared/*` — must **not** import `server-only`.
  Modules used only by Next.js (`server/queue/queue.ts`, `features/*/services/job-service.ts`, `server/http/route-helpers.ts`) should start with `import "server-only"`.
  Never import a `server-only` module from `src/worker/**` or `scripts/**`.
- ESLint enforces the boundaries: `no-restricted-imports` blocks `@/server`, `@/generated`, Prisma, BullMQ/ioredis and Node built-ins in `src/components/**` and `src/features/*/components/**`; Remotion code additionally cannot import feature services/repositories or read `process.env`. Also enforced: `no-console` (except `scripts/`), `no-floating-promises`, `no-explicit-any`.
- `src/shared` holds only what is genuinely shared by several areas. Do not create a catch-all `utils.ts`.
- Route handlers and server actions are thin; no Prisma calls inside React components.

## 6. Coding standards (clean code)

- TypeScript `strict`. No `any`; use `unknown` and narrow with Zod. No non-null `!` assertions to silence the compiler.
- **Validate at every boundary** with Zod: HTTP payloads, env, AI output, uploaded files, job payloads, Remotion props.
- Functions and components do one thing. Consider splitting past ~150–200 lines mixing concerns. No god services, no premature
  abstractions or interfaces (an interface is justified only for a replaceable integration such as `AiProvider`).
- Names: files `kebab-case.ts(x)`, components `PascalCase`, functions/variables `camelCase`, constants `SCREAMING_SNAKE_CASE`, types `PascalCase`. English identifiers; Vietnamese UI copy.
- Prefer named exports. No default exports except where Next.js requires them (`page`, `layout`, `route`, config files).
- Errors: throw typed errors with stable error codes; handle them centrally at the application boundary (route handler / worker dispatcher). Never swallow exceptions; never leave a promise unhandled.
- Logging: use `createLogger()` from `src/shared/logger.ts` (JSON lines); include `jobId`/entity IDs, never log secrets or raw book text (log hash + IDs). `console.*` is allowed only in `scripts/` and `prisma/seed.ts`.
- **Comments: default to none.** Add one only to explain a non-obvious WHY (constraint, workaround, invariant). No narration of what the code does, no references to tasks or tickets.
- No dead code, commented-out code, TODO placeholders, or UI controls that do nothing. Mark unfinished features honestly instead.
- UI states are real: Loading / Empty / Error / Success. Form messages and confirmations for destructive actions are in Vietnamese.
- Keep server state on the server; keep client state local and small.
- Migrations are committed and non-destructive unless the user approved otherwise. Never edit an applied migration.

## 7. Domain invariants (from the requirements — do not violate)

- Book ≠ Chapter ≠ Lesson ≠ Video. A lesson belongs to a book and may cite 1..N chapters via `LessonSource`; a video uses 1..N lessons of the **same** book.
- The original uploaded file is immutable (store SHA-256). Chapter edits produce derived structures only.
- `VideoLesson` stores a **snapshot** of the lesson at selection time; later lesson edits do not change existing videos.
- Only `APPROVED` lessons can seed a new video. Editing an approved script moves it to `NEEDS_REVIEW`.
- Changed script/scene/audio marks previous renders **outdated**; never delete old MP4s automatically.
- AI must not fabricate quotes or citations; AI-invented scenarios must be flagged as illustrative. Never send a whole book to the AI — chapter or selected lessons only.
- Book text is **untrusted data**, never instructions for the AI or the worker.
- Delete is soft delete (or blocked while videos exist); never silently remove media.

## 8. Jobs & queue

- One queue `studio-jobs`; job types: `ANALYZE_CHAPTER`, `GENERATE_VIDEO_SCRIPT`, `GENERATE_SCENE_TTS`, `RENDER_VIDEO` (plus `DIAGNOSTIC_PING` for health checks).
- Worker `concurrency = WORKER_CONCURRENCY` (default 1); global AI concurrency = 1; Remotion `concurrency = RENDER_CONCURRENCY` (default 1).
- Job payloads carry **IDs and small metadata only** — never book text, audio, or secrets.
- Processors must be **idempotent** (BullMQ is at-least-once): same input fingerprint must not duplicate lessons/audio/renders unless forced.
- Worker connections use `maxRetriesPerRequest: null`; producer connections (web) use a low retry count so API calls fail fast when Redis is down.
- Statuses: `QUEUED`, `WAITING_FOR_CLI`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`. Job creation returns HTTP `202`.
- Never fake queue behavior with `setTimeout`/in-memory stubs. Clean up temp files on fail/cancel; graceful shutdown on SIGINT/SIGTERM.

## 9. AI integration rules

- Interface `AiProvider`; implementations: `MockAiProvider` (required, no network), `LocalCliTaskProvider` (default for real AI: writes a task to
  `data/ai-tasks/{jobId}/`, status `WAITING_FOR_CLI`, the **user** runs `pnpm ai:run --job <id>` in their own terminal), `AutomatedCliProvider`
  (optional, disabled by default, not implemented until the user confirms it is permitted by the Anthropic terms).
- Never add `@anthropic-ai/sdk`, never create `ANTHROPIC_API_KEY`, never read/copy/log Claude tokens, cookies or credentials.
- Run subprocesses with `spawn`/`execFile` and an argument array — **never** build shell strings from input, never use `exec` with interpolation.
- Never use `--dangerously-skip-permissions`. When the model only needs to emit JSON, do not grant file-write/shell tools.
- Prompt templates are versioned (`chapter-analysis-v1`, `video-script-v1`). Book content is passed as quoted untrusted data.
- Validate model output with Zod; on schema failure mark the job `FAILED` and store nothing. No unbounded retries (respect quota errors). Timeouts + best-effort cancel.

## 10. Storage & security

- All filesystem access resolves from the absolute `DATA_DIR` through `src/server/storage/safe-path.ts` (blocks `../`, symlink escape, and `/mnt/` locations). Paths stored in the DB are **relative** to `DATA_DIR`.
- Folder names use IDs, never titles/authors. Write to a temp file, then atomic rename.
- Validate upload extension, MIME/signature and size (default max 10 MiB; audio has its own limits).
- Bind to `127.0.0.1`. If ever exposed to LAN/Internet, auth + CSRF + rate limiting are mandatory first.
- Never commit: `data/`, `*.db`, `*.mp3`, `*.mp4`, `.env`, `.env.local`, credentials, `src/generated/`.
- Never print secrets or raw chapter text in logs, errors, or the diagnostics page.
- Do not modify the user's `%UserProfile%\.wslconfig` or any machine-level setting; only document it.

## 11. Short-form video rules

- Profile `SHORT_VERTICAL`: 9:16; final 1080×1920, draft 720×1280; 30 FPS; MP4 H.264 + AAC.
- Duration presets `SHORT_30`, `SHORT_45`, `SHORT_60` (default), `EXTENDED_90` (explicit user choice only). Final render must not exceed the chosen preset; never auto-raise it.
- First scene is `HOOK`: starts at frame 0, ≤ 90 frames, text visible and narration audible immediately; no logo/intro/silence before it.
- Real audio duration (ffprobe) + padding determines timing. Never cut narration or speed it up unnaturally to fit.
- Preview and render share the same composition and the same Zod-validated input props. No hardcoded book titles, lesson counts or narration inside Remotion components.
- Safe-zone overlays are editor-only guides (configurable per platform), never rendered into the MP4.
- Prefer CSS/SVG/text animation; no 3D, no GPU requirement, no network fetches at render time; local assets only.
- Vietnamese diacritics must render correctly (font fallback checked in Chromium on WSL).

## 12. Testing

- Vitest for unit/integration (parsers, safe-path, schemas, services, processors). Playwright smoke test arrives in M6.
- Tests must assert real behavior — no `expect(true)` placeholders. Prefer real SQLite (temp file) and real BullMQ/Redis over mocks for queue code.
- Add tests with the code: parsers (Unicode, BOM, ambiguous headings), path guards, Zod schemas, duration/preflight rules.
- Run the quality gate (§2) before declaring done; report what passed, what failed, and what was not run.

## 13. Git & workflow

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), small commits per milestone/feature.
- Do not commit, push, or open PRs unless the user asks. Never use `--no-verify`; fix the failing hook instead.
- Work milestone by milestone (requirements §17). Finish each milestone's gate before starting the next. Do not expand scope into future features.
- When code structure, commands or env change, update this file, `README.md` and `.env.example` in the same change.

## 14. Milestone status

| Milestone | Scope                                                          | Status                                |
| --------- | -------------------------------------------------------------- | ------------------------------------- |
| M0        | Scaffold & toolchain, schema, Redis/BullMQ/worker, diagnostics | done (gate verified; see `README.md`) |
| M1        | Book import, parser, chapter management                        | done (gate verified)                  |
| M2        | Lessons + mock AI pipeline                                     | not started                           |
| M3        | Video builder / script editor                                  | not started                           |
| M4        | Remotion preview + local render                                | not started                           |
| M5        | Voiceover, real CLI task flow, Jobs dashboard                  | not started                           |
| M6        | Hardening, E2E, docs                                           | not started                           |

## 15. Do / Don't quick list

- DO use `pnpm`; DON'T run `npm`/`yarn` or add other lockfiles.
- DO validate with Zod at boundaries; DON'T trust AI output, uploads, or book text.
- DO keep route handlers thin and return `202` for long work; DON'T await AI/TTS/render in a request.
- DO keep modules shared with the worker free of `server-only`; DON'T import `server-only` modules from `src/worker/**` or `scripts/**`.
- DO spawn with argument arrays; DON'T concatenate shell commands from input.
- DO keep concurrency at 1 until benchmarked; DON'T spawn extra Chromium instances.
- DO keep UI copy in Vietnamese and identifiers in English; DON'T hardcode content in Remotion components.
- DO export only components from `"use client"` files; DON'T import constants/functions from a client module into a Server Component (it receives a client reference, not the value — move shared values to a plain module).
- DO import DTO types from `schemas/*.dto.ts` in client components; DON'T import from `services/` there.
- DO state honestly what is unfinished or unverified; DON'T leave fake buttons or fake queue updates.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
