import { z } from "zod";

export const VIDEO_ASPECT_RATIO = "9:16" as const;
// Mirrors DURATION_PRESETS_SEC of features/videos/domain/duration.ts (a test keeps them equal); config cannot import features.
export const DURATION_PRESETS_SEC = [30, 45, 60, 90, 120, 180, 240, 300] as const;

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const durationPreset = z.coerce
  .number()
  .refine((value): value is (typeof DURATION_PRESETS_SEC)[number] => DURATION_PRESETS_SEC.some((p) => p === value), {
    message: `must be one of ${DURATION_PRESETS_SEC.join(", ")}`,
  });

// An empty value in .env (`MISTRAL_API_KEY=`) means "not set".
const optionalSecret = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());

const isPortrait9x16 = (width: number, height: number) => width * 16 === height * 9;

const regexList = z
  .string()
  .default("[]")
  .transform((raw, ctx) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      const sources = z.array(z.string().min(1)).parse(parsed);
      sources.forEach((source) => new RegExp(source, "iu"));
      return sources;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON array of valid regular expressions" });
      return z.NEVER;
    }
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().startsWith("file:", "DATABASE_URL must be a SQLite file: URL"),
    DATA_DIR: z.string().min(1).default("./data"),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, "REDIS_URL must start with redis:// or rediss://"),

    MAX_IMPORT_SIZE_MB: z.coerce.number().positive().max(100).default(10),
    MAX_PDF_SIZE_MB: z.coerce.number().positive().max(2048).default(500),
    MAX_PDF_PAGES: positiveInt(1000),
    // Empty: the Poppler tools are found on PATH (apt install poppler-utils).
    POPPLER_BIN_DIR: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional()),
    PDF_TOOL_TIMEOUT_SEC: positiveInt(300),
    OCR_COST_CEILING_USD: z.coerce.number().positive().max(1000).default(3),
    MISTRAL_API_KEY: optionalSecret,
    MISTRAL_API_BASE_URL: z.url().default("https://api.mistral.ai"),
    // Pinned on purpose: an alias such as "latest" could change the model (and the price) between runs.
    MISTRAL_OCR_MODEL: z.string().min(1).default("mistral-ocr-4-1"),
    MISTRAL_OCR_USD_PER_1000_PAGES: z.coerce.number().positive().max(1000).default(2),
    GOOGLE_OAUTH_CLIENT_ID: optionalSecret,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalSecret,
    // Only to point the app at a local fake of Google's token and Drive APIs in tests; unset means Google itself.
    GOOGLE_API_BASE_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url().optional()),
    NOTEBOOKLM_MCP_COMMAND: z.string().min(1).default("uvx"),
    // Pinned: the server talks to NotebookLM's undocumented API, so an unreviewed upgrade could change its behaviour.
    NOTEBOOKLM_MCP_PACKAGE: z.string().min(1).default("notebooklm-mcp-cli==0.15.8"),
    NOTEBOOKLM_PROFILE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^[\w.-]{1,64}$/)
        .optional(),
    ),
    NOTEBOOKLM_CALL_TIMEOUT_SEC: positiveInt(180),
    DRIVE_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(1000),
    DRIVE_MAX_REQUESTS_PER_DAY: z.coerce.number().int().positive().max(1_000_000).default(5000),
    DRIVE_MAX_UPLOAD_GIB_PER_DAY: z.coerce.number().positive().max(750).default(10),
    CHAPTER_HEADING_PATTERNS: regexList,

    AI_MODE: z.enum(["mock", "cli-task", "cli-auto"]).default("cli-task"),
    MAX_AI_CONCURRENCY: positiveInt(1),
    CLAUDE_CLI_COMMAND: z.string().min(1).default("claude"),
    AI_TASK_TIMEOUT_SEC: positiveInt(600),

    TTS_MODE: z.enum(["upload", "edge-tts"]).default("edge-tts"),
    TTS_VOICE: z.string().min(1).default("vi-VN-NamMinhNeural"),
    TTS_SPEED: z.coerce.number().int().min(-50).max(50).default(0),
    EDGE_TTS_COMMAND: z.string().min(1).default("edge-tts"),
    SCENE_AUDIO_PADDING_MS: z.coerce.number().int().min(0).max(2000).default(300),
    MAX_AUDIO_UPLOAD_MB: z.coerce.number().positive().max(100).default(20),

    VIDEO_PROFILE: z.literal("SHORT_VERTICAL").default("SHORT_VERTICAL"),
    DEFAULT_VIDEO_DURATION_SEC: durationPreset.default(60),
    MAX_VIDEO_DURATION_SEC: z.coerce.number().int().positive().max(300).default(300),
    RENDER_WIDTH: positiveInt(1080),
    RENDER_HEIGHT: positiveInt(1920),
    RENDER_FPS: positiveInt(30),
    RENDER_CONCURRENCY: positiveInt(1),
    WORKER_CONCURRENCY: positiveInt(1),
    DRAFT_RENDER_WIDTH: positiveInt(720),
    DRAFT_RENDER_HEIGHT: positiveInt(1280),
  })
  .superRefine((env, ctx) => {
    if (!isPortrait9x16(env.RENDER_WIDTH, env.RENDER_HEIGHT)) {
      ctx.addIssue({ code: "custom", path: ["RENDER_HEIGHT"], message: "final render size must be 9:16" });
    }
    if (!isPortrait9x16(env.DRAFT_RENDER_WIDTH, env.DRAFT_RENDER_HEIGHT)) {
      ctx.addIssue({ code: "custom", path: ["DRAFT_RENDER_HEIGHT"], message: "draft render size must be 9:16" });
    }
    if (env.DEFAULT_VIDEO_DURATION_SEC > env.MAX_VIDEO_DURATION_SEC) {
      ctx.addIssue({
        code: "custom",
        path: ["DEFAULT_VIDEO_DURATION_SEC"],
        message: "default duration must not exceed MAX_VIDEO_DURATION_SEC",
      });
    }
  });

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  dataDir: string;
  redisUrl: string;
  import: { maxSizeBytes: number; extraChapterPatterns: string[] };
  pdf: { maxSizeBytes: number; maxPages: number; popplerBinDir: string | undefined; toolTimeoutMs: number };
  ocr: { costCeilingMicroUsd: number };
  mistral: { apiKey: string | undefined; baseUrl: string; ocrModel: string; usdPer1000Pages: number };
  notebookLm: { command: string; packageSpec: string; profile: string | undefined; callTimeoutMs: number };
  drive: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    apiBaseUrl: string | undefined;
    minRequestIntervalMs: number;
    maxRequestsPerDay: number;
    maxUploadBytesPerDay: number;
  };
  ai: {
    mode: "mock" | "cli-task" | "cli-auto";
    maxConcurrency: number;
    claudeCliCommand: string;
    taskTimeoutMs: number;
  };
  tts: {
    mode: "upload" | "edge-tts";
    voice: string;
    speed: number;
    edgeTtsCommand: string;
    paddingMs: number;
    maxUploadBytes: number;
  };
  video: {
    profile: "SHORT_VERTICAL";
    aspectRatio: typeof VIDEO_ASPECT_RATIO;
    durationPresetsSec: readonly number[];
    defaultDurationSec: number;
    maxDurationSec: number;
    final: { width: number; height: number; fps: number };
    draft: { width: number; height: number; fps: number };
  };
  concurrency: { worker: number; render: number };
}

export class ConfigError extends Error {
  readonly code = "INVALID_CONFIG";
}

export function parseAppConfig(source: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`).join("; ");
    throw new ConfigError(`Invalid environment configuration — ${details}`);
  }
  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    dataDir: env.DATA_DIR,
    redisUrl: env.REDIS_URL,
    import: {
      maxSizeBytes: Math.round(env.MAX_IMPORT_SIZE_MB * 1024 * 1024),
      extraChapterPatterns: env.CHAPTER_HEADING_PATTERNS,
    },
    pdf: {
      maxSizeBytes: Math.round(env.MAX_PDF_SIZE_MB * 1024 * 1024),
      maxPages: env.MAX_PDF_PAGES,
      popplerBinDir: env.POPPLER_BIN_DIR,
      toolTimeoutMs: env.PDF_TOOL_TIMEOUT_SEC * 1000,
    },
    ocr: {
      costCeilingMicroUsd: Math.round(env.OCR_COST_CEILING_USD * 1_000_000),
    },
    mistral: {
      apiKey: env.MISTRAL_API_KEY,
      baseUrl: env.MISTRAL_API_BASE_URL.replace(/\/+$/, ""),
      ocrModel: env.MISTRAL_OCR_MODEL,
      usdPer1000Pages: env.MISTRAL_OCR_USD_PER_1000_PAGES,
    },
    notebookLm: {
      command: env.NOTEBOOKLM_MCP_COMMAND,
      packageSpec: env.NOTEBOOKLM_MCP_PACKAGE,
      profile: env.NOTEBOOKLM_PROFILE,
      callTimeoutMs: env.NOTEBOOKLM_CALL_TIMEOUT_SEC * 1000,
    },
    drive: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      apiBaseUrl: env.GOOGLE_API_BASE_URL?.replace(/\/+$/, ""),
      minRequestIntervalMs: env.DRIVE_MIN_REQUEST_INTERVAL_MS,
      maxRequestsPerDay: env.DRIVE_MAX_REQUESTS_PER_DAY,
      maxUploadBytesPerDay: Math.round(env.DRIVE_MAX_UPLOAD_GIB_PER_DAY * 1024 ** 3),
    },
    ai: {
      mode: env.AI_MODE,
      maxConcurrency: env.MAX_AI_CONCURRENCY,
      claudeCliCommand: env.CLAUDE_CLI_COMMAND,
      taskTimeoutMs: env.AI_TASK_TIMEOUT_SEC * 1000,
    },
    tts: {
      mode: env.TTS_MODE,
      voice: env.TTS_VOICE,
      speed: env.TTS_SPEED,
      edgeTtsCommand: env.EDGE_TTS_COMMAND,
      paddingMs: env.SCENE_AUDIO_PADDING_MS,
      maxUploadBytes: Math.round(env.MAX_AUDIO_UPLOAD_MB * 1024 * 1024),
    },
    video: {
      profile: env.VIDEO_PROFILE,
      aspectRatio: VIDEO_ASPECT_RATIO,
      durationPresetsSec: DURATION_PRESETS_SEC,
      defaultDurationSec: env.DEFAULT_VIDEO_DURATION_SEC,
      maxDurationSec: env.MAX_VIDEO_DURATION_SEC,
      final: { width: env.RENDER_WIDTH, height: env.RENDER_HEIGHT, fps: env.RENDER_FPS },
      draft: { width: env.DRAFT_RENDER_WIDTH, height: env.DRAFT_RENDER_HEIGHT, fps: env.RENDER_FPS },
    },
    concurrency: { worker: env.WORKER_CONCURRENCY, render: env.RENDER_CONCURRENCY },
  };
}

let cached: AppConfig | undefined;

export function getAppConfig(): AppConfig {
  cached ??= parseAppConfig(process.env);
  return cached;
}
