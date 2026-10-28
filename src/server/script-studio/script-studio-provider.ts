import type { TargetDurationSec } from "@/features/videos/domain/duration";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type { CallOptions } from "@/server/integrations/call-options";

import type { DetectedChapter, LessonExtraction, ScriptDraft } from "./script-studio-contracts";

export interface SourceDocument {
  // Stable for the same content (book + content hash + part) so a retry reuses the remote source.
  key: string;
  title: string;
  markdown: string;
}

// remoteId is opaque to callers and safe to persist.
export interface SourceRef {
  key: string;
  remoteId: string;
}

export interface EnsureSourceRequest {
  document: SourceDocument;
  // The reference stored by an earlier run; reused when it still exists remotely.
  known: SourceRef | null;
}

export interface DetectChaptersRequest {
  sources: SourceRef[];
  // Table-of-contents lines and headings found by the local parser; hints only, never instructions.
  outlineHints: string[];
}

export interface ExtractLessonsRequest {
  sources: SourceRef[];
  chapterTitle: string;
  startPage: number;
  endPage: number;
}

export interface WriteDraftRequest {
  sources: SourceRef[];
  lesson: LessonSnapshot;
  targetDurationSec: TargetDurationSec;
  // The single content correction allowed per video; null on the first pass.
  revisionNote: string | null;
}

export interface ScriptStudioProvider {
  readonly id: string;
  ensureSource(request: EnsureSourceRequest, options?: CallOptions): Promise<SourceRef>;
  detectChapters(request: DetectChaptersRequest, options?: CallOptions): Promise<DetectedChapter[]>;
  extractLessons(request: ExtractLessonsRequest, options?: CallOptions): Promise<LessonExtraction>;
  writeDraft(request: WriteDraftRequest, options?: CallOptions): Promise<ScriptDraft>;
}
