import type * as DbClient from "@/server/db/client";
import type { TargetDurationSec } from "@/features/videos/domain/duration";
import type { PipelineDeps } from "@/features/productions/services/production-pipeline.service";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import type { ScenePlan, ScenePlanCompiler, ScenePlanRequest } from "@/server/scene-plan/scene-plan-compiler";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";
import type { ScriptStudioProvider, WriteDraftRequest } from "@/server/script-studio/script-studio-provider";

export const SHORT_NARRATION = "Ngắn.";

export interface CountingCalls {
  drafts: WriteDraftRequest[];
  compiles: ScenePlanRequest[];
}

export interface CountingDepsOptions {
  compileFails?: (attempt: number) => Error | null;
  draftFails?: (attempt: number) => Error | null;
  shortenWhenRevised?: boolean;
  afterCompile?: () => Promise<void>;
  bodyFrames?: number;
  // Overrides the length the draft proposes, per attempt.
  proposeSec?: (attempt: number) => TargetDurationSec;
}

// Pipeline providers that count what they are asked and can be told to misbehave. Voicing attaches a fake audio asset
// with a fixed length per scene: the hook fits its 4 s, a shortened scene is 7 s, any other body scene `bodyFrames`
// (6 s by default), so a video lands inside a 30–60 s range unless a test says otherwise.
export function createCountingDeps(
  db: typeof DbClient,
  videoId: () => string,
  options: CountingDepsOptions = {},
): { deps: PipelineDeps; calls: CountingCalls } {
  const calls: CountingCalls = { drafts: [], compiles: [] };
  const studio = new MockScriptStudioProvider();
  const mock = new MockScenePlanCompiler();
  const scriptStudio: ScriptStudioProvider = {
    id: "counting-studio",
    draftVersion: studio.draftVersion,
    ensureSource: (request, callOptions) => studio.ensureSource(request, callOptions),
    detectChapters: (request, callOptions) => studio.detectChapters(request, callOptions),
    extractLessons: (request, callOptions) => studio.extractLessons(request, callOptions),
    writeDraft: async (request, callOptions) => {
      calls.drafts.push(request);
      const failure = options.draftFails?.(calls.drafts.length);
      if (failure) throw failure;
      const draft = await studio.writeDraft(request, callOptions);
      const proposed = options.proposeSec?.(calls.drafts.length);
      return proposed === undefined ? draft : { ...draft, targetDurationSec: proposed };
    },
  };
  const compiler: ScenePlanCompiler = {
    id: "counting-compiler",
    compile: async (request, callOptions): Promise<ScenePlan> => {
      calls.compiles.push(request);
      const failure = options.compileFails?.(calls.compiles.length);
      if (failure) throw failure;
      const plan = await mock.compile(request, callOptions);
      await options.afterCompile?.();
      if (!options.shortenWhenRevised || !request.revisionNote) return plan;
      return {
        hook: { ...plan.hook, narration: SHORT_NARRATION },
        scenes: plan.scenes.map((scene) => ({ ...scene, narration: SHORT_NARRATION })),
      };
    },
  };
  const deps: PipelineDeps = {
    scriptStudio,
    compiler,
    resolveSources: async () => [],
    synthesize: async ({ sceneId }) => {
      const scene = await db.prisma.videoScene.findUniqueOrThrow({ where: { id: sceneId } });
      const asset = await db.prisma.mediaAsset.create({
        data: {
          videoId: videoId(),
          sceneId,
          kind: "VOICEOVER",
          path: `a-${sceneId}.mp3`,
          mimeType: "audio/mpeg",
          fileSizeBytes: 1,
          durationMs: 1000,
        },
      });
      const frames =
        scene.type === "HOOK" ? 90 : scene.narration === SHORT_NARRATION ? 210 : (options.bodyFrames ?? 180);
      await db.prisma.videoScene.update({
        where: { id: sceneId },
        data: { audioAssetId: asset.id, durationFrames: frames },
      });
      return { sceneId, cached: false };
    },
  };
  return { deps, calls };
}
