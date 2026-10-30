import { describe, expect, it } from "vitest";

import { importSelectionError } from "@/features/books/domain/import-selection";

const limits = { maxPdfFiles: 15, maxPdfBytes: 500, maxTextBytes: 100 };
const file = (name: string, size = 10) => ({ name, size });

describe("unified book import selection", () => {
  it("allows one or up to fifteen PDFs, and one supported text file", () => {
    for (const files of [
      [],
      [file("one.PDF")],
      Array.from({ length: 15 }, (_, i) => file(`${i}.pdf`)),
      [file("book.md")],
      [file("book.markdown")],
      [file("book.TXT")],
    ])
      expect(importSelectionError(files, limits)).toBeNull();
  });

  it("rejects more than fifteen PDFs", () => {
    expect(
      importSelectionError(
        Array.from({ length: 16 }, (_, i) => file(`${i}.pdf`)),
        limits,
      ),
    ).toContain("15");
  });

  it.each([
    [file("one.pdf"), file("two.txt")],
    [file("one.md"), file("two.txt")],
  ])("does not mix PDF batches and individual text imports", (...files) => {
    expect(importSelectionError(files, limits)).not.toBeNull();
  });

  it("rejects unsupported, empty and oversized files using their format's limit", () => {
    for (const files of [[file("book.zip")], [file("book.pdf", 0)], [file("book.pdf", 501)], [file("book.md", 101)]])
      expect(importSelectionError(files, limits)).not.toBeNull();
    expect(importSelectionError([file("book.pdf", 500)], limits)).toBeNull();
    expect(importSelectionError([file("book.txt", 100)], limits)).toBeNull();
  });
});
