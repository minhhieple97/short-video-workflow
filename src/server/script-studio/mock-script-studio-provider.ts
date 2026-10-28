import { NARRATIVE_BEATS, type NarrativeBeat } from "@/features/videos/domain/narrative-beats";
import type { CallOptions } from "@/server/integrations/call-options";
import type { DetectedChapter, LessonExtraction, ScriptDraft } from "@/server/script-studio/script-studio-contracts";
import type {
  DetectChaptersRequest,
  EnsureSourceRequest,
  ExtractLessonsRequest,
  ScriptStudioProvider,
  SourceRef,
  WriteDraftRequest,
} from "@/server/script-studio/script-studio-provider";

const PAGES_PER_FAKE_CHAPTER = 10;

// Deterministic and offline (AI_MODE=mock): turns the lesson's own fields into a draft that tells the whole story.
export class MockScriptStudioProvider implements ScriptStudioProvider {
  readonly id = "mock-script-studio";
  readonly uploadedSources: SourceRef[] = [];

  private readonly remoteIdByKey = new Map<string, string>();

  async ensureSource(request: EnsureSourceRequest, options?: CallOptions): Promise<SourceRef> {
    options?.signal?.throwIfAborted();
    const { document, known } = request;

    if (known && this.uploadedSources.some((source) => source.remoteId === known.remoteId)) return known;
    const existingId = this.remoteIdByKey.get(document.key);
    if (existingId) return { key: document.key, remoteId: existingId };

    const remoteId = `fake-source-${this.uploadedSources.length + 1}`;
    const source = { key: document.key, remoteId };
    this.remoteIdByKey.set(document.key, remoteId);
    this.uploadedSources.push(source);
    return source;
  }

  async detectChapters(request: DetectChaptersRequest, options?: CallOptions): Promise<DetectedChapter[]> {
    options?.signal?.throwIfAborted();
    return request.outlineHints.map((title, index) => ({
      title,
      startPage: index * PAGES_PER_FAKE_CHAPTER + 1,
      endPage: (index + 1) * PAGES_PER_FAKE_CHAPTER,
      startAnchor: title,
    }));
  }

  async extractLessons(request: ExtractLessonsRequest, options?: CallOptions): Promise<LessonExtraction> {
    options?.signal?.throwIfAborted();
    return {
      complete: true,
      lessons: [
        {
          title: `Bài học của ${request.chapterTitle}`,
          summary: "Tóm tắt bài học.",
          principle: "Nguyên tắc cốt lõi.",
          realLifeScenario: "Một tình huống đời thường.",
          commonMistake: "Sai lầm thường gặp.",
          betterApproach: "Cách xử lý tốt hơn.",
          actionableStep: "Một hành động cụ thể.",
          sourceExcerpts: [{ page: request.startPage, text: "Trích đoạn trong sách." }],
          exampleIsIllustrative: true,
        },
      ],
    };
  }

  async writeDraft(request: WriteDraftRequest, options?: CallOptions): Promise<ScriptDraft> {
    options?.signal?.throwIfAborted();
    const { lesson } = request;
    const narrationFor: Record<NarrativeBeat, string> = {
      HOOK: `Bạn có biết ${lesson.title}?`,
      SITUATION: lesson.realLifeScenario,
      MISTAKE: lesson.commonMistake,
      LESSON: lesson.principle,
      RESOLUTION: lesson.betterApproach,
      ACTION: lesson.actionableStep,
    };

    return {
      lessonId: lesson.lessonId,
      beats: NARRATIVE_BEATS.map((beat) => ({
        beat,
        narration: narrationFor[beat],
        sourceExcerpts: beat === "LESSON" ? [{ page: 1, text: lesson.sources[0]?.excerpt ?? "Trích đoạn." }] : [],
        illustrative: beat === "SITUATION",
      })),
    };
  }
}
