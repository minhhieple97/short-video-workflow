import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as LessonSources from "@/features/notebooklm/services/lesson-sources.service";
import type * as Studio from "@/features/notebooklm/services/notebooklm-script-studio";
import type * as PipelineDepsModule from "@/features/productions/services/pipeline-deps";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type * as DbClient from "@/server/db/client";
import { CHAT_PERSONA_VERSION } from "@/server/script-studio/notebooklm/prompts/chat-persona-prompt";
import { SCRIPT_DRAFT_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/script-draft-prompt";

import {
  CONTRACT_BOOK,
  describeScriptStudioProviderContract,
  SAMPLE_LESSON,
} from "../helpers/contracts/script-studio-provider-contract";
import { fakeNotebookLm, notebookAnswer, type FakeNotebookLm } from "../helpers/fake-notebooklm";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let studios: typeof Studio;
let lessonSources: typeof LessonSources;
let pipelineDeps: typeof PipelineDepsModule;
let nlm: FakeNotebookLm;
const opened: Studio.NotebookLmScriptStudio[] = [];

const BEATS = [
  { beat: "HOOK", narration: "Vì sao bạn cứ hẹn ngày mai?", illustrative: false, sourceExcerpts: [] },
  { beat: "SITUATION", narration: "Tối nào bạn cũng định tập.", illustrative: true, sourceExcerpts: [] },
  { beat: "MISTAKE", narration: "Bạn đặt mục tiêu một tiếng.", illustrative: true, sourceExcerpts: [] },
  {
    beat: "LESSON",
    narration: "Sách khuyên bắt đầu bằng hai phút.",
    illustrative: false,
    sourceExcerpts: [{ page: 3, text: "Hãy bắt đầu nhỏ." }],
  },
  { beat: "RESOLUTION", narration: "Tối nay chỉ cần hai phút.", illustrative: false, sourceExcerpts: [] },
  { beat: "ACTION", narration: "Mang giày vào ngay.", illustrative: false, sourceExcerpts: [] },
];
const CHAPTERS = [{ title: "Chương 1", startPage: 1, endPage: 10, startAnchor: "Chương 1 mở đầu" }];
const LESSONS = {
  complete: true,
  lessons: [
    {
      title: "Bắt đầu nhỏ",
      summary: "s",
      principle: "p",
      realLifeScenario: "r",
      commonMistake: "m",
      betterApproach: "b",
      actionableStep: "a",
      exampleIsIllustrative: false,
      sourceExcerpts: [{ page: 1, text: "Nội dung." }],
    },
  ],
};

function studio(): Studio.NotebookLmScriptStudio {
  const created = new studios.NotebookLmScriptStudio(nlm.settings);
  opened.push(created);
  return created;
}

async function createBook(id: string, format: "pdf" | "md" = "md") {
  await db.prisma.book.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: id === CONTRACT_BOOK.id ? CONTRACT_BOOK.title : "Sách chữ",
      sourceFilePath: `books/${id}/original.${format}`,
      sourceFileName: `x.${format}`,
      sourceHash: `hash-${id}`,
      sourceFormat: format,
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  studios = await import("@/features/notebooklm/services/notebooklm-script-studio");
  lessonSources = await import("@/features/notebooklm/services/lesson-sources.service");
  pipelineDeps = await import("@/features/productions/services/pipeline-deps");
}, 60_000);

const PROPOSAL = { targetDurationSec: 45, durationReason: "Bài học gọn, đủ kể trong 45 giây." };

beforeEach(async () => {
  nlm = fakeNotebookLm(path.join(env.dataDir, `nlm-${Math.random().toString(36).slice(2)}`));
  nlm.answerQueries([
    { contains: "Hãy xác định các CHƯƠNG", answer: notebookAnswer(CHAPTERS) },
    { contains: "bài học riêng biệt", answer: notebookAnswer(LESSONS) },
    { contains: "Mạch kể bắt buộc", answer: notebookAnswer({ ...PROPOSAL, beats: BEATS }) },
  ]);
  await db.prisma.book.deleteMany();
  await createBook(CONTRACT_BOOK.id);
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((created) => created.close()));
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describeScriptStudioProviderContract("NotebookLM over the fake MCP server", () => studio());

describe("NotebookLmScriptStudio", () => {
  it("writes the draft from the lesson as quoted data and the chosen sources only", async () => {
    const provider = studio();
    const source = await provider.ensureSource({
      book: CONTRACT_BOOK,
      document: { key: "chapter:c1:part:1", title: "Chương 1", markdown: "[Trang 3]\nHãy bắt đầu nhỏ." },
      known: null,
    });

    const draft = await provider.writeDraft({
      sources: [source],
      lesson: SAMPLE_LESSON,
      range: { minDurationSec: 30, maxDurationSec: 45 },
      pace: "STANDARD" as const,
      revisionNote: "Giữ đúng trích đoạn.",
    });

    expect(draft).toMatchObject({ lessonId: SAMPLE_LESSON.lessonId, ...PROPOSAL });
    expect(draft.beats.map((beat) => beat.beat)).toEqual(BEATS.map((beat) => beat.beat));
    const [query] = nlm.calls("notebook_query");
    expect(query?.source_ids).toEqual([source.remoteId.split("#")[1]]);
    expect(String(query?.query)).toContain(JSON.stringify(SAMPLE_LESSON.title));
    expect(String(query?.query)).toContain("trong khoảng 30–45 giây");
    expect(String(query?.query)).toContain("45 (45 giây) ≈ 162 từ");
    expect(String(query?.query)).not.toContain("60 (60 giây)");
    expect(String(query?.query)).toContain('"Giữ đúng trích đoạn."');
  });

  it("gives the book's notebook its chat persona once, before its first question, and keys drafts on it", async () => {
    const provider = studio();
    const document = (part: number) => ({
      key: `chapter:c1:part:${part}`,
      title: "Chương 1",
      markdown: `Phần ${part}.`,
    });
    const first = await provider.ensureSource({ book: CONTRACT_BOOK, document: document(1), known: null });
    const second = await provider.ensureSource({ book: CONTRACT_BOOK, document: document(2), known: null });

    await provider.writeDraft({
      sources: [first, second],
      lesson: SAMPLE_LESSON,
      range: { minDurationSec: 30, maxDurationSec: 45 },
      pace: "STANDARD" as const,
      revisionNote: null,
    });

    expect(nlm.calls("chat_configure")).toHaveLength(1);
    expect(nlm.remote().notebooks[0]?.chat).toMatchObject({ goal: "custom", response_length: "longer" });
    const binding = await db.prisma.notebookBinding.findFirstOrThrow({ where: { bookId: CONTRACT_BOOK.id } });
    expect(binding.chatPersonaVersion).toBe(CHAT_PERSONA_VERSION);
    expect(provider.draftVersion).toBe(`${SCRIPT_DRAFT_PROMPT_VERSION}+${CHAT_PERSONA_VERSION}`);
  });

  it("refuses a proposed length outside the range, which the one correction can fix", async () => {
    nlm.script({ notebook_query: [notebookAnswer({ targetDurationSec: 90, durationReason: "Dài.", beats: BEATS })] });
    const provider = studio();
    const source = await provider.ensureSource({
      book: CONTRACT_BOOK,
      document: { key: "chapter:c1:part:1", title: "Chương 1", markdown: "x" },
      known: null,
    });

    await expect(
      provider.writeDraft({
        sources: [source],
        lesson: SAMPLE_LESSON,
        range: { minDurationSec: 30, maxDurationSec: 60 },
        pace: "STANDARD" as const,
        revisionNote: null,
      }),
    ).rejects.toMatchObject({ code: "DRAFT_LENGTH_OUT_OF_RANGE", kind: "REJECTED" });
  });

  it("refuses a draft out of story order as DRAFT_INVALID, which the one correction can fix", async () => {
    nlm.script({ notebook_query: [notebookAnswer({ ...PROPOSAL, beats: [BEATS[1], BEATS[0], ...BEATS.slice(2)] })] });
    const provider = studio();
    const source = await provider.ensureSource({
      book: CONTRACT_BOOK,
      document: { key: "chapter:c1:part:1", title: "Chương 1", markdown: "x" },
      known: null,
    });

    await expect(
      provider.writeDraft({
        sources: [source],
        lesson: SAMPLE_LESSON,
        range: { minDurationSec: 30, maxDurationSec: 60 },
        pace: "STANDARD" as const,
        revisionNote: null,
      }),
    ).rejects.toMatchObject({ code: "DRAFT_INVALID", kind: "REJECTED" });
  });

  it("refuses to ask about sources that are not this app's, or from two notebooks at once", async () => {
    const provider = studio();
    const request = (remoteIds: string[]) => ({
      sources: remoteIds.map((remoteId) => ({ key: "k", remoteId })),
      lesson: SAMPLE_LESSON,
      range: { minDurationSec: 30, maxDurationSec: 60 },
      pace: "STANDARD" as const,
      revisionNote: null,
    });

    await expect(provider.writeDraft(request(["plain-id"]))).rejects.toMatchObject({
      code: "NOTEBOOKLM_SOURCES_INVALID",
    });
    await expect(provider.writeDraft(request(["nb-1#s-1", "nb-2#s-2"]))).rejects.toMatchObject({
      code: "NOTEBOOKLM_SOURCES_INVALID",
    });
    await expect(provider.writeDraft(request([]))).rejects.toMatchObject({ code: "NOTEBOOKLM_SOURCES_INVALID" });
  });

  it("uses one server process for the run and a new one after close", async () => {
    const provider = studio();
    const document = { key: "chapter:c1:part:1", title: "Chương 1", markdown: "x" };
    await provider.ensureSource({ book: CONTRACT_BOOK, document, known: null });
    await provider.ensureSource({ book: CONTRACT_BOOK, document, known: null });
    const switchesBeforeClose = nlm.calls("profile").filter((call) => call.action === "switch").length;

    await provider.close();
    await provider.ensureSource({ book: CONTRACT_BOOK, document, known: null });

    expect(switchesBeforeClose).toBe(1);
    expect(nlm.calls("profile").filter((call) => call.action === "switch")).toHaveLength(2);
    expect(nlm.calls("source_add")).toHaveLength(1);
  });
});

describe("lesson sources for drafting", () => {
  const lessonCiting = (chapterIds: string[]): LessonSnapshot => ({
    ...SAMPLE_LESSON,
    sources: chapterIds.map((chapterId) => ({ chapterId, chapterTitle: "Chương", excerpt: "x" })),
  });

  it("uploads each cited chapter once, as the same parts the catalogue reads, and skips chapters that are gone", async () => {
    await createBook("text-book");
    const chapter = await db.prisma.chapter.create({
      data: {
        bookId: "text-book",
        order: 1,
        title: "Một",
        content: "Nội dung chương một.",
        contentHash: "h1",
        analysisStatus: "ANALYZED",
      },
    });
    const provider = studio();
    const input = { bookId: "text-book", lesson: lessonCiting([chapter.id, chapter.id, "deleted-chapter"]) };

    const first = await lessonSources.resolveLessonSources(provider, input);
    const second = await lessonSources.resolveLessonSources(provider, input);

    expect(first).toHaveLength(1);
    expect(first[0]?.key).toBe(`chapter:${chapter.id}:part:1`);
    expect(second).toEqual(first);
    expect(nlm.calls("source_add")).toHaveLength(1);
    expect(nlm.calls("source_add")[0]?.text).toBe("Nội dung chương một.");
  });

  it("never reads a chapter of another book", async () => {
    await createBook("text-book");
    await createBook("other-book");
    const foreign = await db.prisma.chapter.create({
      data: {
        bookId: "other-book",
        order: 1,
        title: "Khác",
        content: "Chữ.",
        contentHash: "h2",
        analysisStatus: "ANALYZED",
      },
    });

    await expect(
      lessonSources.resolveLessonSources(studio(), { bookId: "text-book", lesson: lessonCiting([foreign.id]) }),
    ).resolves.toEqual([]);
    expect(nlm.calls("source_add")).toEqual([]);
  });
});

describe("pipeline deps", () => {
  it("drafts with NotebookLM in cli-auto once a profile is set, and says what is missing otherwise", async () => {
    const deps = pipelineDeps.createPipelineDeps("cli-auto", nlm.settings);
    expect(deps.scriptStudio.id).toBe("notebooklm");
    await deps.close?.();

    expect(() => pipelineDeps.createPipelineDeps("cli-auto", null)).toThrow(/NOTEBOOKLM_PROFILE/);
    expect(pipelineDeps.createPipelineDeps("mock", nlm.settings).scriptStudio.id).toBe("mock-script-studio");
  });
});
