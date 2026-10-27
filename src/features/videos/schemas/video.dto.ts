import type { DurationBudget } from "../domain/duration";
import type { HookVariant, SceneType, VisualVariant } from "../domain/scene-types";
import type { VideoStatus } from "../domain/video-status";

export interface HookOptionDto {
  variant: HookVariant;
  narration: string;
  onScreenText: string;
  visualVariant: VisualVariant;
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
}

export interface VideoLessonDto {
  lessonId: string;
  position: number;
  title: string;
  currentStatus: "DRAFT" | "APPROVED" | "ARCHIVED";
  changedSinceSnapshot: boolean;
}

export interface VideoSummary {
  id: string;
  title: string;
  status: VideoStatus;
  book: { id: string; title: string };
  targetDurationSec: number;
  lessonCount: number;
  sceneCount: number;
  updatedAt: string;
}

export interface VideoDetail {
  id: string;
  title: string;
  description: string | null;
  status: VideoStatus;
  book: { id: string; title: string; author: string | null };
  targetDurationSec: number;
  extended: boolean;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  platformPreviewMode: "TIKTOK" | "YOUTUBE_SHORTS" | "FACEBOOK_REELS" | null;
  scriptVersion: number;
  approvedScriptVersion: number | null;
  hookOptions: HookOptionDto[];
  lessons: VideoLessonDto[];
  scenes: SceneDto[];
  budget: DurationBudget;
  hookIssues: string[];
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
