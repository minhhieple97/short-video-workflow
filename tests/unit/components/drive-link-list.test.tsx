import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookDriveLinks } from "@/features/archive/components/book-drive-links";
import { DriveLinkList } from "@/features/archive/components/drive-link-list";
import type { ArchiveDto, BookDriveLinksDto, VideoDriveDto } from "@/features/archive/schemas/archive.dto";

const archive = (overrides: Partial<ArchiveDto> = {}): ArchiveDto => ({
  id: "archive-1",
  provider: "google-drive",
  status: "COMPLETED",
  errorCode: null,
  errorMessage: null,
  retries: 0,
  createdAt: "2026-10-30T09:00:00.000Z",
  completedAt: null,
  folderUrl: "https://drive.google.com/drive/folders/f",
  videoUrl: "https://drive.google.com/file/d/v1/view",
  files: [],
  ...overrides,
});
const drive = (overrides: Partial<ArchiveDto> | null): VideoDriveDto => ({
  renderId: "render-1",
  archive: overrides === null ? null : archive(overrides),
  outdated: false,
});

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

describe("DriveLinkList", () => {
  const videos: BookDriveLinksDto["videos"] = [
    { id: "a", title: "Thói quen nhỏ", drive: drive({}) },
    { id: "b", title: "Môi trường tốt", drive: drive({ status: "RUNNING", videoUrl: null, folderUrl: null }) },
    { id: "c", title: "Chưa có bản cuối" },
    { id: "d", title: "Chưa lưu Drive", drive: drive(null) },
    { id: "e", title: "Cũng đã lên", drive: drive({ videoUrl: "https://drive.google.com/file/d/v5/view" }) },
  ];

  it("counts the videos that have a link and offers to copy exactly those", () => {
    const html = renderToStaticMarkup(<DriveLinkList videos={videos} />);

    expect(html).toContain("2/5 video đã có link Drive");
    expect(html).toContain("Sao chép 2 link");
  });

  it("lists every video in the order given, each with where it stands on Drive", () => {
    const html = renderToStaticMarkup(<DriveLinkList videos={videos} />);

    const titles = ["Thói quen nhỏ", "Môi trường tốt", "Chưa có bản cuối", "Chưa lưu Drive", "Cũng đã lên"];
    const positions = titles.map((title) => html.indexOf(`>${title}</span>`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(html).toContain("Đã lưu Drive");
    expect(html).toContain("Đang lưu Drive");
    expect(html).toContain("Chưa render bản cuối");
    expect(html).toContain("Chưa lưu Drive");
  });

  it("links the videos that are on Drive and no other", () => {
    const links = hrefs(renderToStaticMarkup(<DriveLinkList videos={videos} />));

    expect(links).toContain("https://drive.google.com/file/d/v1/view");
    expect(links).toContain("https://drive.google.com/file/d/v5/view");
    expect(links.filter((link) => link?.startsWith("https://drive.google.com/"))).toHaveLength(2);
  });

  it("offers no copy while nothing has a link, and says so when the book has no video", () => {
    const none = renderToStaticMarkup(<DriveLinkList videos={[{ id: "c", title: "Chưa" }]} />);
    expect(none).toContain("0/1 video đã có link Drive");
    expect(none).not.toContain("Sao chép");

    expect(renderToStaticMarkup(<DriveLinkList videos={[]} />)).toContain("Sách này chưa có video nào.");
  });
});

describe("BookDriveLinks", () => {
  it("starts closed and asks for nothing until it is opened", () => {
    const html = renderToStaticMarkup(<BookDriveLinks bookId="book-1" refreshKey="0-0" />);

    expect(html).toContain("Link Drive của video");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Đang tải danh sách");
    expect(html).not.toContain("video đã có link Drive");
  });
});
