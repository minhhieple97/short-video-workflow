import { createAiProvider } from "@/server/ai";
import type { AiProvider, AiTaskContext } from "@/server/ai/ai-provider";
import { publishMetadataInputSchema, publishMetadataOutputSchema } from "@/server/ai/contracts/publish-metadata";
import { PUBLISH_METADATA_PROMPT_VERSION } from "@/server/ai/prompts/publish-metadata-prompt";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

import { acceptPublishMetadata, publishClaimSources } from "../domain/publish-metadata";
import { upsertPublishMetadata } from "../repositories/publish-metadata.repository";
import { inputHash, withAiRun, type AiWaitingForCli } from "./ai-run";
import { scriptTextHash } from "./scene-records";
import { lessonSnapshotsOf } from "./video-mapper";
import { requireVideo } from "./video.service";

// Writes a new title, caption and hashtags for the script as it is now, replacing the current set (an edited one too:
// the page asks first). Unlike the set written with a script, a proposal that breaks a rule fails the job, because
// producing the set is all this job does.
export async function runPublishMetadataGeneration(run: {
  videoId: string;
  jobRecordId: string | null;
  provider?: AiProvider;
  resume?: AiTaskContext["resume"];
  signal?: AbortSignal;
  execution?: AiTaskContext["execution"];
}): Promise<{ hashtags: number } | AiWaitingForCli> {
  const video = await requireVideo(run.videoId);
  const scenes = video.scenes
    .filter((scene) => !scene.hidden)
    .map(({ type, title, narration, onScreenText }) => ({ type, title, narration, onScreenText }));
  if (scenes.length === 0) throw new AppError("SCRIPT_EMPTY", "Chưa có kịch bản để viết tiêu đề và caption.", 409);

  const provider = run.provider ?? createAiProvider(getAppConfig().ai.mode);
  const input = publishMetadataInputSchema.parse({
    videoId: video.id,
    book: { title: video.book.title, author: video.book.author },
    lessons: lessonSnapshotsOf(video),
    scenes,
    promptVersion: PUBLISH_METADATA_PROMPT_VERSION,
  });

  const meta = {
    jobRecordId: run.jobRecordId,
    mode: provider.mode,
    promptVersion: PUBLISH_METADATA_PROMPT_VERSION,
    hash: inputHash(run.execution ? { input, execution: run.execution } : input),
    execution: run.execution,
    stage: run.execution ? "publish-metadata" : undefined,
    invalidOutputMessage: "Kết quả AI không đúng định dạng tiêu đề, caption và hashtag; không thay đổi gì.",
    resume: run.resume,
    signal: run.signal,
  };
  return withAiRun(meta, async (context) => {
    const result = await provider.generatePublishMetadata(input, context);
    if (result.status === "waiting_for_cli") return { kind: "waiting", taskDir: result.taskDir };
    const output = publishMetadataOutputSchema.parse(result.output);
    if (output.videoId !== video.id) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp video.", 422);
    const { metadata, issue } = acceptPublishMetadata(output.publish, publishClaimSources(input));
    if (issue) {
      const madeUp = issue.code === "PUBLISH_METADATA_UNSUPPORTED_CLAIM";
      throw new AppError(
        madeUp ? issue.code : "INVALID_AI_OUTPUT",
        `${issue.message} Không thay đổi gì.`,
        422,
        madeUp ? { details: { ...issue.claims } } : undefined,
      );
    }
    await upsertPublishMetadata(video.id, {
      metadata,
      origin: "AI",
      promptVersion: PUBLISH_METADATA_PROMPT_VERSION,
      sourceTextHash: scriptTextHash(input.scenes),
    });
    return { kind: "done", value: { hashtags: metadata.hashtags.length }, output };
  });
}
