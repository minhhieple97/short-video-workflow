import type { AiTaskContext, AiTaskResult } from "@/server/ai/ai-provider";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

import { validateStoryDraft, type DraftRequest, type StoryDraft } from "./contracts";
import type { ScriptDraftWriter } from "./script-draft-writer";

export class MockScriptDraftWriter implements ScriptDraftWriter {
  readonly id = "mock-script-draft";

  async writeDraft(request: DraftRequest, context: AiTaskContext): Promise<AiTaskResult<StoryDraft>> {
    context.signal?.throwIfAborted();
    const lesson = request.input.lessons[0];
    const source = request.sourcePack.sources[0];
    const main = request.settings.characters.profiles.find(
      (profile) => profile.id === request.settings.characters.primaryCharacterId,
    );
    if (!lesson || !source || !main) throw new Error("Missing mock story input.");
    const scenario = lesson.realLifeScenario.toLocaleLowerCase("vi-VN");
    const selected = request.fixedCast
      ? request.fixedCast.profiles
      : [
          main,
          ...request.settings.characters.profiles.filter(
            (profile) =>
              profile.enabled && profile.id !== main.id && scenario.includes(profile.name.toLocaleLowerCase("vi-VN")),
          ),
        ].slice(0, request.settings.characters.maxCharacters);
    const draft = await new MockScriptStudioProvider().writeDraft({
      sources: [],
      lesson,
      range: request.input,
      pace: request.input.pace,
      storyAngle: request.input.storyAngle,
      revisionNote: request.revisionNote,
    });
    const hook = {
      variant: "CONTRAST" as const,
      narration: `${main.name} lại chọn cách cũ.`,
      onScreenText: "Lựa chọn cũ, cái giá mới",
      visualVariant: "HOOK_QUESTION" as const,
    };
    const output = validateStoryDraft(
      {
        ...draft,
        schemaVersion: "story-draft-v2",
        lessonIds: request.input.lessons.map((item) => item.lessonId),
        cast: selected.map((profile) => ({
          characterId: profile.id,
          role: profile.id === main.id ? "Nhân vật chính thử một lựa chọn khác" : "Người tham gia tình huống minh họa",
        })),
        hookOptions: [hook, { ...hook, variant: "QUESTION", narration: `${main.name} sẽ thử điều gì khác?` }],
        logic: {
          question: lesson.title,
          oldChoiceMotive: lesson.commonMistake,
          mechanism: lesson.principle,
          changedActions: [lesson.actionableStep],
          observableResult: lesson.betterApproach,
          limits: "Tình huống minh họa, kết quả còn phụ thuộc bối cảnh.",
          sourceIds: [source.id],
        },
        beats: draft.beats.map((beat, index) => ({
          ...beat,
          narration: beat.beat === "HOOK" ? hook.narration : beat.narration,
          characterIds:
            index === 0
              ? [main.id]
              : selected
                  .slice(((index - 1) * 2) % selected.length, (((index - 1) * 2) % selected.length) + 2)
                  .map((profile) => profile.id),
          illustrative: ["HOOK", "SITUATION", "MISTAKE", "RESOLUTION"].includes(beat.beat),
          sourceExcerpts:
            beat.beat === "LESSON" ? [{ sourceId: source.id, page: source.page, text: source.text.slice(0, 200) }] : [],
        })),
      },
      request,
    );
    return { status: "completed", output };
  }
}
