import { z } from "zod";

export const VIDEO_ASPECT_RATIO = "9:16" as const;
export const DURATION_PRESETS_SEC = [30, 45, 60, 90] as const;

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const durationPreset = z.coerce
  .number()
  .refine((value): value is (typeof DURATION_PRESETS_SEC)[number] => DURATION_PRESETS_SEC.some((p) => p === value), {
    message: `must be one of ${DURATION_PRESETS_SEC.join(", ")}`,
  });

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
    CHAPTER_HEADING_PATTERNS: regexList,

    AI_MODE: z.enum(["mock", "cli-task"]).default("cli-task"),
    MAX_AI_CONCURRENCY: positiveInt(1),
    CLAUDE_CLI_COMMAND: z.string().min(1).default("claude"),

    TTS_MODE: z.enum(["upload", "edge-tts"]).default("edge-tts"),
    TTS_VOICE: z.string().min(1).default("vi-VN-NamMinhNeural"),
    TTS_SPEED: z.coerce.number().int().default(0),

    VIDEO_PROFILE: z.literal("SHORT_VERTICAL").default("SHORT_VERTICAL"),
    DEFAULT_VIDEO_DURATION_SEC: durationPreset.default(60),
    MAX_VIDEO_DURATION_SEC: z.coerce.number().int().positive().max(90).default(90),
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
  ai: { mode: "mock" | "cli-task"; maxConcurrency: number; claudeCliCommand: string };
  tts: { mode: "upload" | "edge-tts"; voice: string; speed: number };
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
    ai: { mode: env.AI_MODE, maxConcurrency: env.MAX_AI_CONCURRENCY, claudeCliCommand: env.CLAUDE_CLI_COMMAND },
    tts: { mode: env.TTS_MODE, voice: env.TTS_VOICE, speed: env.TTS_SPEED },
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
