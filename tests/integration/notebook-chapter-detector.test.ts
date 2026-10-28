import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Detector from "@/features/notebooklm/services/notebook-chapter-detector";
import type * as DbClient from "@/server/db/client";

import { fakeNotebookLm, notebookAnswer, type FakeNotebookLm } from "../helpers/fake-notebooklm";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let detectors: typeof Detector;
let nlm: FakeNotebookLm;
let bookId: string;

const CHAPTERS = [
  { title: "Sức mạnh của thói quen nhỏ", startPage: 3, endPage: 9, startAnchor: "Sức mạnh của thói quen nhỏ" },
  { title: "Bản sắc", startPage: 10, endPage: 20, startAnchor: "Bản sắc và thói quen" },
];
const input = (extractionId = "ex-1") => ({
  extractionId,
  book: { id: bookId, title: "Thói quen nguyên tử" },
  outline: {
    markdown: "[Trang 3] Sức mạnh của thói quen nhỏ\n[Trang 10] Bản sắc và thói quen",
    hints: ["Bản sắc .... 10"],
  },
  pageCount: 20,
});

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  detectors = await import("@/features/notebooklm/services/notebook-chapter-detector");
}, 60_000);

beforeEach(async () => {
  nlm = fakeNotebookLm(path.join(env.dataDir, `nlm-${Math.random().toString(36).slice(2)}`));
  await db.prisma.book.deleteMany();
  bookId = (
    await db.prisma.book.create({
      data: {
        title: "Thói quen nguyên tử",
        sourceFilePath: "books/x/original.pdf",
        sourceFileName: "x.pdf",
        sourceHash: `hash-${Math.random()}`,
        sourceFormat: "pdf",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    })
  ).id;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("NotebookLM chapter detector", () => {
  it("is not offered unless NotebookLM is configured", () => {
    expect(detectors.createNotebookChapterDetector(null)).toBeNull();
  });

  it("uploads the outline once as the book's source and asks about that source only", async () => {
    const detector = detectors.createNotebookChapterDetector(nlm.settings);
    nlm.script({ notebook_query: [notebookAnswer(CHAPTERS), notebookAnswer(CHAPTERS)] });

    await expect(detector?.detect(input())).resolves.toEqual(CHAPTERS);
    await expect(detector?.detect(input())).resolves.toEqual(CHAPTERS);

    const [notebook] = nlm.remote().notebooks;
    expect(nlm.remote().notebooks).toHaveLength(1);
    expect(notebook?.sources).toHaveLength(1);
    expect(notebook?.sources[0]?.title).toContain("Dàn ý theo trang");
    const queries = nlm.calls("notebook_query");
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({ source_ids: [notebook?.sources[0]?.id], new_conversation: true });
    expect(String(queries[0]?.query)).toContain('"Bản sắc .... 10"');
    expect(nlm.calls("source_add")).toHaveLength(1);
  });

  it("refuses an answer that is not the JSON it asked for", async () => {
    const detector = detectors.createNotebookChapterDetector(nlm.settings);
    nlm.script({
      notebook_query: [{ status: "success", answer: "Sách có 2 chương.", conversation_id: "c", sources_used: [] }],
    });

    await expect(detector?.detect(input())).rejects.toMatchObject({
      code: "NOTEBOOKLM_CHAPTERS_INVALID",
      kind: "REJECTED",
    });
  });
});
