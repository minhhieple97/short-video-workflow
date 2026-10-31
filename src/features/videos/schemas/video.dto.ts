import type { JobStatus } from "@/shared/types/job";

import type { TimedWord } from "../domain/caption-pages";
import type { CastSnapshot } from "../domain/characters";
import type { DurationBudget } from "../domain/duration";
import type { GenerationProvenance } from "../domain/generation-provenance";
import type { PublishOrigin } from "../domain/publish-metadata";
import type { Pace } from "../domain/pace";
import type { HookVariant, SceneType, VisualVariant } from "../domain/scene-types";
import type { VideoStatus } from "../domain/video-status";
import type { Illustration } from "../domain/illustration";
import type { ShotPlan, AiShot } from "../domain/shot-plan";

export interface HookOptionDto {
  shots?: AiShot[];
  variant: HookVariant;
  narration: string;
  onScreenText: string;
  visualVariant: VisualVariant;
  illustration?: Illustration;
  estimatedSeconds: number;
}

export interface SceneDto {
  id: string;
  order: number;
  type: SceneType;
  title: string | null;
  narration: string;
  onScreenText: string;
  visualVariant: VisualVariant;
  hookVariant: HookVariant | null;
  estimatedSeconds: number;
  durationFrames: number;
  hidden: boolean;
  version: number;
  audioAssetId: string | null;
  audio: SceneAudioDto | null;
  // The scene's own cartoon; null means the default picture for its type.
  illustration: Illustration | null;
  // The scene's planned shots; null means one shot showing the illustration.
  shots: ShotPlan | null;
}

export interface SceneAudioDto {
  assetId: string;
  provider: string;
  durationMs: number;
  leadingSilenceMs: number;
  // The speed the voice was made at, relative to normal; null for an uploaded clip.
  speedPercent: number | null;
  url: string;
  // When each word is spoken in the clip, if the voice reported it (null for uploads and older voices).
  wordBoundaries: TimedWord[] | null;
}

// What the voice of one scene is waiting on, or last failed at; a scene with neither has no entry.
export interface SceneVoiceJobDto {
  jobId: string;
  // An unfinished status (queued, running, waiting, being cancelled) or FAILED.
  status: JobStatus;
  errorMessage: string | null;
}

export interface VideoLessonDto {
  lessonId: string;
  position: number;
  title: string;
  currentStatus: "DRAFT" | "APPROVED" | "ARCHIVED";
  changedSinceSnapshot: boolean;
}

export interface PublishMetadataDto {
  title: string;
  caption: string;
  // Without "#".
  hashtags: string[];
  origin: PublishOrigin;
  // The script's text changed after this set was written or last saved.
  outdated: boolean;
  updatedAt: string;
}

export interface VideoSummary {
  id: string;
  title: string;
  status: VideoStatus;
  book: { id: string; title: string };
  // The AI's proposed length once a script exists (durationProposed), otherwise the range's maximum.
  targetDurationSec: number;
  minDurationSec: number;
  maxDurationSec: number;
  durationProposed: boolean;
  lessonCount: number;
  sceneCount: number;
  // On-screen text of the HOOK scene (what viewers read at frame 0); null until a script exists.
  hookText: string | null;
  updatedAt: string;
}

export interface VideoDetail {
  cast?: CastSnapshot;
  generation?: GenerationProvenance;
  id: string;
  title: string;
  description: string | null;
  status: VideoStatus;
  book: { id: string; title: string; author: string | null };
  // The AI's proposed length (durationReason says why) once a script exists; the range's maximum before that.
  targetDurationSec: number;
  minDurationSec: number;
  maxDurationSec: number;
  pace: Pace;
  // Visible scenes whose voice was made at another speed than this video's pace asks for.
  staleVoiceSceneCount: number;
  durationReason: string | null;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  platformPreviewMode: "TIKTOK" | "YOUTUBE_SHORTS" | "FACEBOOK_REELS" | null;
  scriptVersion: number;
  approvedScriptVersion: number | null;
  // The automated readiness checks passed for exactly the current script version (not a human approval).
  autoReady: boolean;
  hookOptions: HookOptionDto[];
  lessons: VideoLessonDto[];
  scenes: SceneDto[];
  budget: DurationBudget;
  hookIssues: string[];
  // Title, caption and hashtags for posting; null until an AI wrote them.
  publish: PublishMetadataDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenderDto {
  id: string;
  quality: "DRAFT" | "FINAL";
  status: "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED" | "CANCELLED";
  width: number;
  height: number;
  fps: number;
  scriptVersion: number;
  outdated: boolean;
  durationMs: number | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  fileUrl: string | null;
  downloadUrl: string | null;
}
