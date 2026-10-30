# AGENTS.md — Book Video Studio

Instructions for AI coding agents and contributors. Source of truth for product behavior is
[`docs/requirements.md`](./docs/requirements.md) (Vietnamese); the technical design is [`docs/architecture.md`](./docs/architecture.md)
and setup/env/troubleshooting is [`docs/operations.md`](./docs/operations.md). When this file and the requirements disagree on product
behavior, the requirements win; when they disagree on engineering practice, this file wins.

## 1. Project snapshot

Local-first, single-user app (Windows + WSL2) that turns an imported book into **vertical videos** (9:16, for TikTok / YouTube
Shorts / Facebook Reels). Manual flow (`.txt`/`.md`): Book → Chapter → Lesson (Claude analysis, user approves) → Video → Scenes →
Vietnamese voiceover → Remotion render. Batch flow (PDF): text layer + OCR → chapters → NotebookLM lesson catalogue → chosen lessons →
NotebookLM draft → Claude scene plan → voiceover → render → Google Drive archive, with no approval step.

Hard constraints (do not relax without an explicit user decision):

- **Stack is fixed:** Next.js App Router + TypeScript strict, Tailwind CSS, shadcn/ui, Zod, Prisma + SQLite, BullMQ + Redis,
  standalone Node.js worker, Remotion. **No NestJS, no microservices, no cloud infra.** One repo, one web process, one worker process.
- **No Anthropic API / SDK / API key**, ever. AI runs through `MockAiProvider` or the user's own Claude Code CLI (see §9).
- **Outbound integrations are limited to the ones the project owner approved for v1.2** (see `docs/requirements.md`): Mistral OCR
  Batch (the user's own key), NotebookLM through an MCP stdio subprocess of the worker, and Google Drive through OAuth `drive.file` for archiving
  rendered videos, plus optional one-way Telegram chat/forum notifications through `NotificationProvider` (one topic per book, no bot commands or media uploads). Each lives behind its own port in `src/server/` (`OcrProvider`, `ScriptStudioProvider`, `ScenePlanCompiler`,
  `VideoArchiveProvider`); do not add other cloud services, and do not route them through `AiProvider`. They are implemented and tested
  against local fakes only; acceptance with real accounts is still to do (`docs/operations.md`). Tests never reach them (`tests/helpers/offline-env.ts`).
  Voice-over goes through the `TtsProvider` port (edge-tts, run locally, is the only adapter); a cloud or paid TTS adapter would be a new
  outbound integration, so it needs the owner's decision first.
- **Vertical video only:** 9:16, final 1080×1920 / draft 720×1280, 30 FPS, H.264 + AAC, 30 s – 5 min. The user sets a length range;
  the AI proposes the length inside it (§11). Still one lesson per batch-produced video. No 16:9.
- **Vietnamese (vi-VN)** for UI copy, scripts, narration, on-screen text and captions. Code, identifiers, file names: English.
- **Localhost only** (`127.0.0.1`). No auth, no multi-user, no public exposure.
- **Low-resource machine:** worker concurrency = 1, Remotion render concurrency = 1 until benchmarked on the real machine.

## 2. Commands

**Package manager: pnpm only.** Never run `npm` or `yarn`, never commit another lockfile. `packageManager` is pinned in `package.json`.

| Task                                           | Command                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Install deps (also runs `prisma generate`)     | `pnpm install`                                                    |
| Start Redis (Docker, recommended)              | `docker compose up -d`                                            |
| Apply migrations / create DB                   | `pnpm db:migrate`                                                 |
| Regenerate Prisma client                       | `pnpm db:generate`                                                |
| Seed demo data                                 | `pnpm db:seed`                                                    |
| Web dev server (127.0.0.1:3000)                | `pnpm dev`                                                        |
| Web dev server + worker, one terminal          | `pnpm dev:all`                                                    |
| Worker (watch mode)                            | `pnpm worker:dev`                                                 |
| Worker (no watch)                              | `pnpm worker:start`                                               |
| Is a worker running? (exit 0 yes, 1 no)        | `pnpm worker:status`                                              |
| List / run Claude CLI tasks (AI_MODE=cli-task) | `pnpm ai:run --list` · `pnpm ai:run --job <jobId> [--dry-run]`    |
| Environment diagnostics                        | `pnpm diagnose`                                                   |
| Telegram test / retry one failed notification  | `pnpm telegram --test` · `pnpm telegram --retry <notificationId>` |
| Remotion Studio (inspect compositions)         | `pnpm remotion:studio`                                            |
| Render fixture: contact sheet / ms per frame   | `pnpm render:stills` · `pnpm bench:render`                        |
| Regenerate character / prop art                | `pnpm peeps:generate` · `pnpm props:generate --source <dir>`      |
| Lint / format check / typecheck                | `pnpm lint` · `pnpm format:check` · `pnpm typecheck`              |
| Tests                                          | `pnpm test` (`pnpm test:watch` while developing)                  |
| E2E smoke test (builds first; needs Redis)     | `pnpm test:e2e`                                                   |
| Production build                               | `pnpm build`                                                      |

First-time setup: `cp .env.example .env` → `pnpm install` → `docker compose up -d` → `pnpm db:migrate` → `pnpm db:seed`.
Run for development in three terminals (Redis, `pnpm worker:dev`, `pnpm dev`) or two (Redis, `pnpm dev:all`). Only one worker runs per
Redis database: `worker:dev`, `worker:start` and `dev:all` refuse to start another and print the running one's status (§8). `dev:all`
starts only what is missing: no second worker, and no second web server when the web port (`PORT`, default 3000) is taken, since
`next dev` would silently move to the next free port and leave two dev servers on one folder.

Toolchain notes (pinned on purpose — do not bump blindly):

- `pnpm doctor` is a pnpm built-in and shadows scripts of that name; the project script is `pnpm diagnose`.
- Prisma is pinned to **7.10.1** (npm `latest` for the CLI is an 8.0 release candidate). Config lives in `prisma.config.ts`; the SQLite URL is not in `schema.prisma`.
- TypeScript is pinned to **6.0.3** and ESLint to **9.x** until `typescript-eslint` / `eslint-config-next` plugins support TS 7 / ESLint 10.
- After editing `prisma/schema.prisma`: `pnpm db:migrate --name <short_description>` then `pnpm db:generate` (Prisma 7 no longer regenerates the client on migrate); commit the migration.
- Runtime path resolution (`process.cwd()` + data dir) carries `/* turbopackIgnore: true */` to stop Turbopack from tracing the whole project; keep it on new runtime-path code.
- The block at the bottom of this file between `BEGIN:nextjs-agent-rules` / `END:nextjs-agent-rules` is maintained by `next dev`; leave it alone.

**Quality gate before reporting any task done:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass;
also run `pnpm test:e2e` when a change touches a user flow, the worker, or rendering.
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
    (studio)/          Studio pages: dashboard, books, videos, jobs, settings (+ shell layout, error, not-found)
    api/               books, chapters, lessons, videos, scenes, renders, media, jobs, health, diagnostics
  components/
    ui/                shadcn/ui components, themed to the "Studio Ink" look (see §15); badge has tone variants for statuses
    layout/            App shell + dark sidebar (polls /api/status), theme provider/toggle, page header, breadcrumbs, URL tabs, empty state, stat tile
  features/            Feature-first modules; layers created on first use:
                         domain/ (pure, framework-free rules — client-safe), schemas/ (Zod input + *.dto.ts types),
                         services/ (business logic), repositories/ (Prisma), components/ (React)
    books/             import parser (domain/), staging + immutable original/chapter files, import wizard, library/detail UI
    extraction/        v1.2 PDF books: streamed upload (`pdf-import.service.ts`), `EXTRACT_PDF` run (`extraction-run.service.ts`:
                       text layer → OCR batches → canonical Markdown → chapters), retry/reconcile, OCR budget and results,
                       PDF upload tab + extraction progress card (`components/`)
    chapters/          chapter listing/reading/rename, analysis runner (worker) + analysis requests (web, server-only; the chapters tab ticks
                       chapters through `useChapterSelection`, shared by the analyse button and the table);
                       PDF chapters are catalogued by NotebookLM part by part when it is set up (`notebook-chapter-analysis`)
    lessons/           lesson domain (fields, excerpt verification), repository, review service, library/review UI
    videos/            short-form domain (scene types, layouts, duration budget, pace, story angles, snapshots), script generation/editing, editor UI;
                       the title/caption/hashtag set to post with (`domain/publish-metadata.ts`: rules + hashtag normalizing,
                       `publish-proposal.ts` for the set written with a script, `publish-generation`/`publish-request` services,
                       Đăng tải tab in `components/publish/`)
    jobs/              job payload schemas, JobRecord/AiRun repositories, enqueue/retry/cancel services, jobs dashboard UI
    notebooklm/        v1.2 NotebookLM bindings: one notebook per book and account, one source per part and revision (title marker);
                       `NotebookLmScriptStudio` (the real `ScriptStudioProvider`: one MCP process per run, `notebookId#sourceId` refs,
                       JSON answers only), chapter part documents shared by cataloguing and drafting, chapter detector
    drive/             v1.2 Google Drive connection: OAuth start/callback state (hashed, one-time), connection status DTO
    archive/           v1.2 render archives (one per render and destination, one entry per uploaded file, resumable checkpoints)
    productions/       v1.2 production batches: lesson selection (`production-request`, catalogue page `/books/:id/produce`), the
                       item pipeline (`production-pipeline`, one resumable `RUN_PRODUCTION_ITEM` job per item), correction,
                       readiness, cancel/retry, start-up reconcile, and the progress pages (`/productions`, `production-view`)
    book-imports/      multi-PDF batches (1–15 books), staged uploads, serial book/chapter scheduling and all-lesson production;
                       worker book-import sweeper orchestrates existing jobs; progress at /book-imports
  lib/                 client-safe helpers: utils.ts (shadcn `cn()`), api-client.ts (typed fetch + ApiError), format.ts (vi-VN),
                       use-row-selection.ts (ticked table rows: only rows on the shown page count; bulk buttons and the chapters button use it)
  server/              Server-side infrastructure (never imported by client components or Remotion)
    db/                client.ts: Prisma + better-sqlite3 singleton, WAL setup (shared by Next, worker, scripts)
    queue/             constants, redis-connection.ts (shared: connection factories, probe, redaction), queue.ts (Next-only producer),
                       worker-lock.ts (the one-worker-per-Redis lock and the worker status read by the web, `pnpm diagnose` and scripts)
    storage/           DATA_DIR resolution (paths.ts), safe-path guard, atomic writes
    ai/                AiProvider interface, MockAiProvider, LocalCliTaskProvider, AutomatedCliProvider, contracts/ (Zod I/O),
                       prompts/ (versioned), cli-task/ (task files, ask-claude.ts + runner + output parsing; shared by `pnpm ai:run`
                       and cli-auto)
    tts/               `TtsProvider` port (`tts-provider.ts`, vendor-free) + `createTtsProvider()` (`index.ts`, picks the adapter from `TTS_MODE`);
                       `edge/` holds the edge-tts adapter: it spawns `edge-tts-words.py` (edge-tts's Python API, for word timings) with argv
                       under the Python from `edge-tts-python.ts`, text via file, and retries the service's transient no-audio failures.
                       Failures are `IntegrationError`s with a `TTS_*` code; the contract suite is `tests/helpers/contracts/tts-provider-contract.ts`
    diagnostics/       health checks aggregated for /settings, /api/health and `pnpm diagnose`
    render/            Remotion bundle + renderMedia wrapper and localhost asset server (worker only), webpack "@/" alias
    media/             ffprobe wrapper, silence trim/measure (ffmpeg)
    pdf/               Poppler wrapper (`poppler.ts`: pdfinfo/pdftotext/pdfimages/pdfseparate/pdfunite from argv, absolute paths
                       only, timeout + cancel, PDF_ENCRYPTED/PDF_CORRUPT/PDF_TOOL_MISSING); worker only
    integrations/      IntegrationError (kind AUTH/QUOTA/TRANSIENT/REJECTED/UNKNOWN_OUTCOME) + CallOptions shared by the v1.2 ports
    ocr/mistral/       typed REST client for Mistral Files/Batch (`mistral-client.ts`) and the OcrProvider adapter on it (submit, collect, cleanup); `createOcrProvider()` in `ocr/index.ts`
    ocr/ script-studio/ scene-plan/ archive/   v1.2 ports + vendor-free DTOs only (OcrProvider, ScriptStudioProvider, ScenePlanCompiler,
                       VideoArchiveProvider); adapters sit in their vendor subfolders (Claude's scene-plan compiler in scene-plan/).
                       Fakes + contract suites live in tests/helpers/{fakes,contracts}; every adapter must pass its port's contract suite
    script-studio/notebooklm/  MCP stdio client (`McpStdioClient`: argv spawn, explicit env, bounded stderr never in errors)
                       for the NotebookLM server (`notebooklm-mcp-cli`, pinned), session/profile/envelope, versioned prompts (`prompts/`)
    archive/google-drive/  Google OAuth helpers (PKCE, loopback redirect, `drive.file` only), the credential store
                       (`data/credentials/google-drive.json`, mode 0600, never in SQLite, DTOs or logs), `DriveAccessToken`,
                       and `GoogleDriveArchiveProvider` (folder tree with pre-generated IDs, resumable upload, checksum verify)
    http/              route-helpers.ts (AppError → JSON, readJson/parseInput with Zod), page-helpers.ts (orNotFound)
  worker/              Standalone process: main.ts, processors/ (dispatcher + one per job type), lifecycle/ (heartbeat + lock renewal, shutdown)
  remotion/            Pure React video code: index.ts (registerRoot), root.tsx (ShortVideo + calculateMetadata), compositions/,
                       layers/ (visual track with transitions, voice + caption track, progress chrome), scenes/ (one scene = its shots
                       + headline), stage/ (camera, sets, Open Peeps cast per action, extras), text/ (kinetic headline, text cards),
                       captions/ (caption pages), timeline/ (scene transitions), peeps/ + props/ (generated art, see
                       THIRD_PARTY_NOTICES.md), theme/ (tokens, bundled font); frame-driven only
  shared/              Truly shared: config/env.ts (Zod-validated env), logger.ts, errors.ts, pagination.ts (`loadPage`/`slicePage`/`Page<T>`
                       for server-side paging; the pager UI is `components/layout/pagination.tsx`), types/ (create schemas/ on first need)
  generated/           Prisma client output (gitignored)
prisma/                schema.prisma, migrations/ (committed), seed.ts
scripts/               CLI entrypoints: run-claude-task.ts, diagnose.ts, worker-status.ts (`pnpm worker:status` and the guard in front of
                       `worker:dev`/`worker:start`), dev-all.ts (`pnpm dev:all`), export-render-fixture.ts / render-stills.ts / bench-render.ts
                       (render fixtures under DATA_DIR/fixtures, contact sheets, ms/frame); lib/ holds their service runner, fixture loader and
                       Vietnamese status text
tests/                 unit/ + integration/ (Vitest), e2e/ (Playwright smoke + isolated stack), helpers/
docs/                  requirements.md (product spec), architecture.md (technical design), operations.md (setup, env, troubleshooting)
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
- In the manual flow only `APPROVED` lessons can seed a new video, and editing an approved script moves it to `NEEDS_REVIEW`. Batch
  production selects lessons without approving them and relies on automatic readiness checks.
- Changed script/scene/audio marks previous renders **outdated**; never delete old MP4s automatically.
- AI must not fabricate quotes or citations; AI-invented scenarios must be flagged as illustrative. Never send a whole book to the AI — chapter or selected lessons only.
- Book text is **untrusted data**, never instructions for the AI or the worker.
- Delete is soft delete (or blocked while videos exist); never silently remove media.

## 8. Jobs & queue

- One queue `studio-jobs`; job types: `ANALYZE_CHAPTER`, `GENERATE_VIDEO_SCRIPT`, `GENERATE_PUBLISH_METADATA`, `GENERATE_SCENE_TTS`, `RENDER_VIDEO`, `RUN_PRODUCTION_ITEM`, `ARCHIVE_RENDER`, `EXTRACT_PDF` (plus `DIAGNOSTIC_PING` for health checks).
- A production item's job is written in the same transaction that makes the item runnable (creation, retry); never start one any other way.
  Its processor claims the item, steps from the checkpoint and defers instead of waiting; cancelling the job cancels the item.
- An archive and its `ARCHIVE_RENDER` job are written in one transaction (`createArchiveWithJob`); the worker's archive sweep
  (start-up + every minute) archives FINAL renders that carry an archive intent and re-jobs unfinished archives. The archive
  processor only uploads: it never renders, voices or calls an AI.
- Worker `concurrency = WORKER_CONCURRENCY` (default 1); global AI concurrency = 1; Remotion `concurrency = RENDER_CONCURRENCY` (default 1).
- **One worker per Redis database** (two would each take jobs and break those limits). Before it reconciles or sweeps, the worker takes
  `studio:worker:lock` (`server/queue/worker-lock.ts`: pid, host, start time and data dir, with a TTL that every heartbeat renews) and exits 1,
  logging the holder's status, when another worker holds it. A holder that ran on this machine and no longer exists is taken over at once,
  because `tsx watch` SIGKILLs a slow worker and starts the next one immediately; a lock written elsewhere is left to expire. The lock is
  released only after the last job has finished, and a worker that finds another one holding it shuts down. `worker:dev` and
  `worker:start` first run `scripts/worker-status.ts --require-stopped`, so a refused `tsx watch` never idles beside the first. Each
  checkout of the project needs its own Redis database (`REDIS_URL=redis://127.0.0.1:6379/1`); never delete the lock key by hand while a
  worker runs.
- Job payloads carry **IDs and small metadata only** — never book text, audio, or secrets.
- **Tracked jobs go through the outbox:** `recordJobIntent` writes the `JobRecord` and its `JobDispatch` row in one transaction, then
  `dispatchJobIntent` enqueues and marks `dispatchedAt`; the worker's `sweepDueJobIntents` delivers rows that never reached Redis and delayed
  rows (`availableAt`). A processor that must wait on a remote operation returns `deferred(retryAfterMs)` (never sleeps or polls inside the
  worker); the dispatcher reschedules the same `JobRecord` through the outbox under a new job id. Do not call `queue.add` for a tracked job anywhere else (`pnpm ai:run`'s requeue is the one legacy exception), and
  `reconcileJobRecords` must keep skipping jobs whose row is undelivered.
- Processors must be **idempotent** (BullMQ is at-least-once): same input fingerprint must not duplicate lessons/audio/renders unless forced.
- Worker connections use `maxRetriesPerRequest: null`; producer connections (web) use a low retry count so API calls fail fast when Redis is down.
- Statuses: `QUEUED`, `WAITING_FOR_CLI`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`. Job creation returns HTTP `202`.
- Never fake queue behavior with `setTimeout`/in-memory stubs. Clean up temp files on fail/cancel; graceful shutdown on SIGINT/SIGTERM.

## 9. AI integration rules

- Interface `AiProvider`; implementations, chosen by `AI_MODE`: `MockAiProvider` (`mock`, required, no network), `LocalCliTaskProvider`
  (`cli-task`, the default for real AI: writes a task to `data/ai-tasks/{jobId}/`, status `WAITING_FOR_CLI`, the **user** runs
  `pnpm ai:run --job <id>` in their own terminal) and `AutomatedCliProvider` (`cli-auto`, opt-in: the worker runs the same
  task through the user's own logged-in Claude Code CLI right away). The project owner enabled `cli-auto` for personal localhost use; it stays
  off in `.env.example`. Both CLI paths go through `server/ai/cli-task/ask-claude.ts` — never call `claude` any other way.
- Never add `@anthropic-ai/sdk`, never create `ANTHROPIC_API_KEY`, never read/copy/log Claude tokens, cookies or credentials.
- Run subprocesses with `spawn`/`execFile` and an argument array — **never** build shell strings from input, never use `exec` with interpolation.
- Never use `--dangerously-skip-permissions`. When the model only needs to emit JSON, do not grant file-write/shell tools.
- Prompt templates are versioned (`chapter-analysis-v1`, `video-script-v9`, `scene-plan-v8`, `publish-metadata-v1` — the three last share
  `prompts/publish-rule.ts`, so editing it bumps all three — and for NotebookLM `notebooklm-chapter-detection-v2`,
  `notebooklm-lesson-extraction-v2`, `notebooklm-script-draft-v6`, and the notebook's chat persona `notebooklm-chat-persona-v2`, applied once per
  notebook through `chat_configure` and re-applied when its version changes); changing a prompt's text means bumping its version (the draft and
  persona versions also key the draft cache). Book content is passed as quoted untrusted data. The storytelling text lives in
  `prompts/storytelling-rule.ts` and is shared like `publish-rule.ts`: editing it bumps every prompt that uses it. Telling a story better is
  done when the script is written, never by bumping `chapter-analysis` or `lesson-extraction` (that re-analyses every chapter).
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
- Lengths are the presets in `DURATION_PRESETS_SEC` (`features/videos/domain/duration.ts`, 30 s – 5 min). Videos and batches carry a
  range (`minDurationSec`/`maxDurationSec`, default `DEFAULT_MIN_VIDEO_DURATION_SEC`–`MAX_VIDEO_DURATION_SEC`, the latter also enforced
  server-side). The AI proposes `targetDurationSec` inside it with a reason (`durationReason`): Claude with the manual script, NotebookLM
  with the batch draft; a proposal outside the range is rejected. The hard limit is the range's maximum (`OVER_TARGET`); under the
  minimum is a warning by hand and blocking in batch readiness (`UNDER_MIN`, corrected by the script studio). Never widen a range, cut
  narration or change the pace to fit. Up to `MAX_STORY_SCENES` (30) scenes or draft beats after the hook.
- First scene is `HOOK`: starts at frame 0, ≤ 120 frames (`HOOK_MAX_FRAMES`, 4 s), text visible and narration audible immediately; no logo/intro/silence before it.
- Real audio duration (ffprobe) + padding determines timing. Never cut narration or speed it up beyond the pace the user chose.
- **Pace is the one reading-speed control, and only the user sets it** (`features/videos/domain/pace.ts`: `STANDARD` 0%, `FAST` +15%, `FASTER` +30%;
  `Video.pace` and `ProductionBatch.pace`, new ones start from `DEFAULT_PACE`). It sets the voice speed, the pause after each scene
  (`framesForAudio`), the AI's word budget (`syllablesPerSecond` in the three prompts, the estimates and the draft cache key) and how
  fast scene pictures play (`paceFactor`: a `<Sequence playbackRate>` around each shot's picture only, so the voice, captions, shot cuts and
  scene length never follow it). Nothing changes a pace by itself: not `UNDER_MIN`, not `OVER_TARGET`, not the AI correction. A voice made at another
  speed stays until the user regenerates it (`staleVoiceSceneCount`, `POST /api/videos/:id/tts` with `scope: "all"`; an uploaded clip is never
  replaced). Adding a pace or changing a number in the table changes what the same props look like, so bump `RENDER_TEMPLATE_VERSION`.
- **Story angle** (`features/videos/domain/story-angle.ts`): six ways to tell the same six-part story (`PEAK_FIRST`, `DIALOGUE`, `TWO_PATHS`,
  `MYTH_BUST`, `TWIST`, `ESCALATION`), given by `pickStoryAngle(seed, step)`, which is pure and stores nothing: a manual script uses
  `(video.id, video.scriptVersion)` (writing it again moves to the next angle), a production item `(item.batchId, item.position)` (neighbours
  differ; a retry keeps its angle). `storyAngle` is required in `videoScriptInputSchema` and `WriteDraftRequest` and is part of the draft cache
  key; the frame, its order checks, the scene types and hook variants do not change. The characters, places and lines a story makes up are
  illustrative: the draft flags every beat that has them, and a video made by hand flags its hook, situation, mistake and resolution scenes
  (`illustrativeSceneTypes`). A quotation the compiler keeps must read as the draft wrote it; the source check ignores case, spacing and
  punctuation, never the words.
- Preview and render share the same composition and the same Zod-validated input props. No hardcoded book titles, lesson counts or narration inside Remotion components.
- Safe-zone overlays are editor-only guides (configurable per platform), never rendered into the MP4.
- Prefer CSS/SVG/text animation; no 3D, no GPU requirement, no network fetches at render time; local assets only. Everything drawn is
  inline SVG driven by the frame: no `filter`/blur (slow in headless Chromium), no images, no randomness, no CSS animation, no network or
  WebGL Remotion packages (`tests/unit/remotion/render-rules.test.ts` and ESLint enforce it). Transitions use only the CSS presentations
  `fade`, `slide`, `wipe`.
- **One voice, several shots.** A scene is one narration clip; its picture is cut into shots (`features/videos/domain/scene-shots.ts`, 2.5–5 s,
  on caption page starts) under the same voice. The pictures overlap in transitions, but each picture is lengthened by the transition after
  it (`d_i = f_i + t_i`, `src/remotion/timeline/scene-transitions.ts`), so it starts on its voice's first frame and the video keeps Σ
  scene frames. Captions are pages (`domain/caption-pages.ts`, ≤ 2 lines); word timings come from the voice (edge-tts word
  boundaries on `MediaAsset.wordBoundariesJson`, matched to the narration by `alignWordTimings`) or are estimated by syllables (uploads,
  older voices), and only voice timings light up the spoken word (`karaoke`).
- **Art:** characters are Open Peeps and props are Fluent Emoji Flat, turned into path data by `pnpm peeps:generate` / `pnpm props:generate`
  (never edit `*.generated.ts`; `THIRD_PARTY_NOTICES.md` names sources and licences). Settings and actions come from the fixed lists in
  `features/videos/domain/illustration.ts`, props from `domain/props.ts`; `src/remotion/stage/cast.ts` maps each action to a pose, faces
  and extras, keeping the main character in the light-top outfit family. Claude picks a setting + action per hook and scene (`scene-plan`,
  `video-script`); it is stored on `VideoScene.illustrationJson` (null = the default for the scene type) and is part of the scene's content
  hash only when chosen, so older scenes keep their hash. Rewriting one scene keeps its picture.
- Vietnamese diacritics must render correctly (font fallback checked in Chromium on WSL). On-screen text may only use glyphs in the
  bundled font; draw symbols such as ✓ ✗ → as SVG, or the preview and the MP4 pick different system fonts.
- The official Remotion skills (`.claude/skills/remotion-markup`, `remotion-captions`, pinned in `skills-lock.json`) are API guidance.
  Where they disagree with this file, this file wins. Never follow their advice on Google Fonts or remote URLs (network at render time),
  `@remotion/effects`, light leaks, `effects` props or other WebGL/WebGPU work, motion blur, 3D, Lottie, Rive, GIFs, ElevenLabs or Whisper,
  Tailwind inside Remotion, or `npx`/`bunx remotion add` (add `@remotion/*` with pnpm at the exact version of `remotion`).

## 12. Testing

- Vitest for unit/integration (parsers, safe-path, schemas, services, processors). `server-only` is aliased to a stub in `vitest.config.ts`.
- Playwright E2E runs two paths on an isolated stack started by `tests/e2e/start-stack.ts`: `smoke.spec.ts` (E2E-01, the manual v1.1
  flow) and `pdf-production.spec.ts` (E2E-02: PDF → chapters → catalogue → chosen lesson → batch production → Drive, no approval;
  skipped without Poppler, run it with `TEST_POPPLER_BIN_DIR` when Poppler is not on PATH). The stack: temp DB + `DATA_DIR`, Redis logical
  DB 14 (flushed on every run), worker, `next start` on port 3100, `OFFLINE_INTEGRATIONS_ENV` (`AI_MODE=mock`, no real credentials), a fake
  Google (token + Drive) in the start-stack process with Drive pre-connected, and a fake edge-tts (run as `EDGE_TTS_PYTHON`) that writes real
  MP3s and word timings. It reuses
  Remotion's headless Chromium (no `playwright install`). Keep each spec one end-to-end path; put edge cases in integration tests.
- Tests must assert real behavior — no `expect(true)` placeholders. Prefer real SQLite (temp file) and real BullMQ/Redis over mocks for queue code.
- Add tests with the code: parsers (Unicode, BOM, ambiguous headings), path guards, Zod schemas, duration/preflight rules.
- Run the quality gate (§2) before declaring done; report what passed, what failed, and what was not run.

## 13. Git & workflow

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), small commits per feature.
- Do not commit, push, or open PRs unless the user asks. Never use `--no-verify`; fix the failing hook instead.
- Work in small steps and pass the gate after each one. Do not expand scope beyond `docs/requirements.md`.
- Keep each topic in one document: product behavior → `docs/requirements.md`, design → `docs/architecture.md`, setup/env/errors →
  `docs/operations.md` (its env table must match `.env.example`), code map/commands/rules → this file. When code structure, commands or env
  change, update the owning document and `.env.example` in the same change.
- Third-party art or fonts enter only through a generator script in `scripts/` with a manifest, and get a section in
  `THIRD_PARTY_NOTICES.md` in the same change.

## 14. Status

Both flows are implemented and pass the gate (E2E-01 manual, E2E-02 PDF → Drive). Mistral OCR, NotebookLM and Google Drive run only against
local fakes so far; `docs/requirements.md` (implementation status) and `docs/operations.md` (real-account acceptance) say what is still
unverified. The hook limit is 4 s / 120 frames for every flow. Each video carries one title/caption/hashtag set written with its script
(and archived as `publish.txt`); its quality with real Claude is not yet judged.

## 15. Visual language ("Studio Ink")

- Design source: the Claude Design canvas "Book Video Studio — giao diện mới" (Tổng quan, Trình biên tập video, Màu sắc/chữ/thành phần). Tokens live
  in `src/app/globals.css`; never hard-code a palette hex in a component when a token exists.
- Shell is deep ink (`--sidebar`); actions are violet (`--primary`); tangerine (`--brand`) marks the vertical-video accent (hook, brand mark, job count).
- **Status and scene colors are tones**, not ad-hoc Tailwind colors: use `Badge variant="mint|amber|violet|blue|rose|orange|slate"`
  (mint = done/approved, amber = waiting/needs review, violet = running, blue = waiting for CLI or situation, rose = error, slate = neutral).
  A status always carries its text label — color never stands alone. Scene types keep one color via `features/videos/components/scene-tone.ts`.
- Font is Be Vietnam Pro (bundled in `public/fonts`, weights 400–800, latin + vietnamese subsets); no network font loading.
- Cards are white with `shadow-card` on the lavender page background; primary buttons carry `shadow-raised`; radii come from `--radius`.
- Videos are shown as 9:16 poster cards (`VideoCard`) wherever they are browsed visually; tables stay for dense lists.
- **Light, dark and system themes:** `next-themes` toggles the `dark` class on `<html>` (`ThemeProvider`, `ThemeToggle` in the sidebar, stored in
  `localStorage["studio-theme"]`, default = system). Every color must come from a token that `.dark` redefines; check new UI in both themes.
  Poster/progress colors that stand for the rendered video are intentionally fixed hexes. Shadows are `--elevation-*` variables so `.dark` can override them.
- **Lists that can grow are paged on the server**, never cut in the browser: the service takes a `PageRequest` (`toPageRequest(searchParams.x, SIZE)`)
  and returns a `Page<T>` through `loadPage` (count, then `skip/take`; a page past the end serves the last one), the page renders
  `<Pagination page param>`, and the address carries the page (`?page=`, or one param per list when several share a page such as the book's tabs:
  `chapterPage`/`lessonPage`/`videoPage`, kept in a plain `domain/paging.ts`, not in a `"use client"` file). Reset the page when a filter changes.
  Keep the unpaged `listX` for callers that need every row (dashboard counts, pickers, the JSON API).
- **Bulk actions on a table** tick rows with `useRowSelection(idsOnThePage)`; the count on a bulk button is what a click changes (use the domain
  rule the server enforces, e.g. `canMoveLesson`), the button is off at 0, and a destructive bulk action asks first.
- **Text that comes from a book or an AI is unbounded** (a PDF chapter title can be a whole paragraph). Never render it raw: clamp list
  and table cells with `line-clamp-2 wrap-break-word` and put the full text in `title`; give tables that hold such text
  `table-fixed` with fixed widths on the other columns; keep one-line status text on `truncate` inside a `min-w-0` row with the label
  `shrink-0`; cut dropdown options with `truncateText()` (`lib/format.ts`); `PageHeader` and `Breadcrumbs` already shrink and clamp.
- **Icon-only actions use `IconButton`** (`components/layout/icon-button.tsx`): `label` is both the tooltip and the accessible name, `note` is the
  reason when it is disabled (a disabled button gets its tooltip from a wrapper). It is for page-header, table-row and toolbar actions whose
  icon is clear. Keep the text on a button whose label carries live state or a count ("Phân tích 2 chương còn lại"), on dialog/form footers
  (Lưu, Huỷ, confirm) and on a button that status messages or docs tell the user to press by name ("Thử lại" on the PDF extraction card).
  Touch screens have no hover, so never rely on the tooltip alone for meaning.
- The video editor docks the phone preview beside the editor at ≥ 1280 px (`EditorWorkspace`; one Player mounted at a time). Keep `<main>` on
  `overflow-x-clip`: `overflow-x-hidden` makes it a scroll container and breaks `position: sticky`.

## 16. Do / Don't quick list

- DO use `pnpm`; DON'T run `npm`/`yarn` or add other lockfiles.
- DO validate with Zod at boundaries; DON'T trust AI output, uploads, or book text.
- DO keep route handlers thin and return `202` for long work; DON'T await AI/TTS/render in a request.
- DO keep modules shared with the worker free of `server-only`; DON'T import `server-only` modules from `src/worker/**` or `scripts/**`.
- DO spawn with argument arrays; DON'T concatenate shell commands from input.
- DO keep concurrency at 1 until benchmarked; DON'T spawn extra Chromium instances.
- DO keep UI copy in Vietnamese and identifiers in English; DON'T hardcode content in Remotion components.
- DO export only components from `"use client"` files; DON'T import constants/functions from a client module into a Server Component (it receives a client reference, not the value — move shared values to a plain module).
- DO import DTO types from `schemas/*.dto.ts` in client components; DON'T import from `services/` there.
- DO run Claude only through `askClaude()` (used by `pnpm ai:run` and, when `AI_MODE=cli-auto`, by the worker) with no built-in tools, `--strict-mcp-config` (no MCP servers from the user's config) and a sanitized env; DON'T spawn `claude` from the web, from route handlers, or in parallel, and DON'T make `cli-auto` the default.
- DO keep `@remotion/bundler` / `@remotion/renderer` in worker-only modules (`server/render/*`, `*-runner.ts`); DON'T import them from anything a route or page imports.
- DO keep per-frame state (current frame/time) in a small sibling of `<Player>` and pass the click event to `play(e)`; DON'T put it in the
  component that renders `<Player>` (it would re-render 30 times a second).
- DO share one browser per render (`openBrowser` → `puppeteerInstance` for `selectComposition` and `renderMedia`); measure before tuning
  render speed — frame capture dominates, encoder preset and card shadows did not matter.
- DO build composition props only through `toCompositionProps()` so the Player and the render stay identical; DON'T render editor guides (safe zones) inside the composition.
- DO make a render from its `RenderSnapshot` (captured at request time); DON'T read the live video in `render-runner.ts` (ESLint enforces it) and DON'T change a stored snapshot. Bump `RENDER_TEMPLATE_VERSION` when a Remotion change alters what the same props look like.
- DO state honestly what is unfinished or unverified; DON'T leave fake buttons or fake queue updates.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
