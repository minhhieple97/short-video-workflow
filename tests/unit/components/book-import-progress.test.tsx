import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookImportProgress } from "@/features/book-imports/components/book-import-progress";
import type { BookImportDto } from "@/features/book-imports/schemas/book-import.dto";

type Item = BookImportDto["items"][number];

const item = (overrides: Partial<Item> = {}): Item => ({
  id: "item-1",
  position: 1,
  fileName: "sach-mot.pdf",
  bookId: "book-1",
  status: "PRODUCING",
  errorMessage: null,
  productionIds: ["production-1"],
  videosCompleted: 2,
  videosOnDrive: 1,
  videosTotal: 3,
  ...overrides,
});

const batch = (overrides: Partial<BookImportDto> = {}): BookImportDto => ({
  id: "batch-1",
  status: "RUNNING",
  minDurationSec: 30,
  maxDurationSec: 60,
  pace: "STANDARD",
  items: [item()],
  cooldowns: [],
  driveConnected: true,
  ...overrides,
});

const html = (dto: BookImportDto) => renderToStaticMarkup(<BookImportProgress initial={dto} />);
const text = (markup: string) => markup.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");

describe("BookImportProgress", () => {
  it("says for each book how many videos are done and how many are on Drive", () => {
    expect(text(html(batch()))).toContain("Video hoàn tất: 2/3 · Đã lưu Drive: 1/3");
  });

  it("offers the list of Drive links for a book that has videos, and for no other", () => {
    const withVideos = html(batch());
    expect(withVideos).toContain("Link Drive của video");
    expect(withVideos).toContain('aria-expanded="false"');

    const without = html(batch({ items: [item({ videosTotal: 0, videosCompleted: 0, videosOnDrive: 0 })] }));
    expect(without).not.toContain("Link Drive của video");
    expect(without).not.toContain("Đã lưu Drive");

    expect(html(batch({ items: [item({ bookId: null })] }))).not.toContain("Link Drive của video");
  });

  it("explains, with a way to the settings, why nothing reaches Drive while no account is connected", () => {
    const disconnected = html(batch({ driveConnected: false }));

    expect(text(disconnected)).toContain("Chưa kết nối Google Drive nên video mới chỉ nằm trên máy này.");
    expect(disconnected).toContain('href="/settings"');
    expect(html(batch())).not.toContain("Chưa kết nối Google Drive");
  });

  it("does not warn about Drive before any video exists", () => {
    const early = html(
      batch({
        driveConnected: false,
        items: [item({ videosTotal: 0, videosCompleted: 0, videosOnDrive: 0, status: "EXTRACTING" })],
      }),
    );

    expect(early).not.toContain("Chưa kết nối Google Drive");
  });

  it("keeps its links to the book and to each production", () => {
    const markup = html(batch());

    expect(markup).toContain('href="/books/book-1"');
    expect(markup).toContain('href="/productions/production-1"');
  });
});
