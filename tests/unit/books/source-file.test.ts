import { describe, expect, it } from "vitest";

import {
  assertAcceptedMimeType,
  assertWithinSizeLimit,
  decodeSourceText,
  detectSourceFormat,
  sanitizeFileName,
  titleFromFileName,
} from "@/features/books/domain/source-file";

const encode = (text: string) => new TextEncoder().encode(text);

function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrow(expect.objectContaining({ code }) as Error);
}

describe("decodeSourceText", () => {
  it("strips a UTF-8 BOM, normalises CRLF and composes Vietnamese to NFC", () => {
    const decomposed = "Chương".normalize("NFD");
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(`${decomposed} 1\r\nNội dung\rDòng cuối`)]);
    expect(decodeSourceText(bytes)).toBe("Chương 1\nNội dung\nDòng cuối");
  });

  it("rejects PDF, ZIP/EPUB, binary, invalid UTF-8 and empty input", () => {
    expectCode(() => decodeSourceText(encode("%PDF-1.7 ...")), "UNSUPPORTED_FILE_TYPE");
    expectCode(() => decodeSourceText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])), "UNSUPPORTED_FILE_TYPE");
    expectCode(() => decodeSourceText(new Uint8Array([0x41, 0x00, 0x42, 0x00])), "BINARY_FILE");
    expectCode(() => decodeSourceText(new Uint8Array([0xc3, 0x28])), "INVALID_ENCODING");
    expectCode(() => decodeSourceText(encode(" \n\t ")), "EMPTY_FILE");
  });
});

describe("file metadata validation", () => {
  it("detects supported formats by extension", () => {
    expect(detectSourceFormat("sach.MD")).toBe("md");
    expect(detectSourceFormat("sach.markdown")).toBe("md");
    expect(detectSourceFormat("sach.txt")).toBe("txt");
    expectCode(() => detectSourceFormat("sach.pdf"), "UNSUPPORTED_FILE_TYPE");
    expectCode(() => detectSourceFormat("sach"), "UNSUPPORTED_FILE_TYPE");
  });

  it("accepts text MIME types and generic uploads but rejects others", () => {
    expect(() => assertAcceptedMimeType("text/markdown")).not.toThrow();
    expect(() => assertAcceptedMimeType("text/plain; charset=utf-8")).not.toThrow();
    expect(() => assertAcceptedMimeType("")).not.toThrow();
    expectCode(() => assertAcceptedMimeType("application/pdf"), "UNSUPPORTED_FILE_TYPE");
  });

  it("enforces the size limit", () => {
    expect(() => assertWithinSizeLimit(10, 10)).not.toThrow();
    expectCode(() => assertWithinSizeLimit(11, 10), "FILE_TOO_LARGE");
  });

  it("keeps only the base name of uploaded files, removing traversal and control characters", () => {
    expect(sanitizeFileName("../../secret.md")).toBe("secret.md");
    expect(sanitizeFileName("C:\\Users\\me\\sách hay.txt")).toBe("sách hay.txt");
    expect(sanitizeFileName("bad\u0000name.md")).toBe("badname.md");
    expect(sanitizeFileName("../")).toBe("khong-ten.txt");
  });

  it("derives a readable title from the file name", () => {
    expect(titleFromFileName("atomic-habits_sample.md")).toBe("atomic habits sample");
  });
});
