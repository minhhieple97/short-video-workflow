import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DriveCard } from "@/features/archive/components/drive-card";
import { VideoDriveStatus } from "@/features/archive/components/video-drive-status";
import type { ArchiveDto, VideoDriveDto } from "@/features/archive/schemas/archive.dto";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const VIDEO_URL = "https://drive.google.com/file/d/video-1/view";
const FOLDER_URL = "https://drive.google.com/drive/folders/folder-1";

const file = (kind: string, status: string) => ({
  kind,
  remoteName: `${kind}.bin`,
  status,
  bytes: 10,
  uploadedBytes: 10,
  verifiedAt: null,
});

const archive = (overrides: Partial<ArchiveDto> = {}): ArchiveDto => ({
  id: "archive-1",
  provider: "google-drive",
  status: "COMPLETED",
  errorCode: null,
  errorMessage: null,
  retries: 0,
  createdAt: "2026-10-30T09:00:00.000Z",
  completedAt: "2026-10-30T09:01:00.000Z",
  folderUrl: FOLDER_URL,
  videoUrl: VIDEO_URL,
  files: [file("VIDEO", "VERIFIED"), file("SCRIPT", "VERIFIED"), file("MANIFEST", "VERIFIED")],
  ...overrides,
});

const drive = (overrides: Partial<VideoDriveDto> = {}): VideoDriveDto => ({
  renderId: "render-1",
  archive: archive(),
  outdated: false,
  ...overrides,
});

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
const status = (value: VideoDriveDto | undefined) =>
  renderToStaticMarkup(<VideoDriveStatus videoId="video-1" drive={value} />);

describe("VideoDriveStatus", () => {
  it("sends a video with no finished final render to the Render page, saying so", () => {
    const html = status(undefined);

    expect(html).toContain("Chưa render bản cuối");
    expect(hrefs(html)).toEqual(["/videos/video-1/render"]);
  });

  it("says a finished final render has not been put on Drive, and where to do it", () => {
    const html = status(drive({ archive: null }));

    expect(html).toContain("Chưa lưu Drive");
    expect(hrefs(html)).toEqual(["/videos/video-1/render"]);
  });

  it("shows a saved video with the link that opens it on Drive", () => {
    const html = status(drive());

    expect(html).toContain("Đã lưu Drive");
    expect(html).toContain("Mở video");
    expect(hrefs(html)).toEqual([VIDEO_URL]);
    expect(html).not.toContain("Bản cũ");
  });

  it("marks a copy on Drive that shows an older script", () => {
    expect(status(drive({ outdated: true }))).toContain("Bản cũ");
  });

  it("shows progress without a link while the video itself is still going up", () => {
    const html = status(drive({ archive: archive({ status: "RUNNING", videoUrl: null, folderUrl: null }) }));

    expect(html).toContain("Đang lưu Drive");
    expect(hrefs(html)).toEqual([]);
  });

  it("shows a failure", () => {
    expect(status(drive({ archive: archive({ status: "FAILED", videoUrl: null, folderUrl: null }) }))).toContain(
      "Lưu Drive lỗi",
    );
  });
});

const card = (props: Partial<Parameters<typeof DriveCard>[0]> = {}) =>
  renderToStaticMarkup(
    <DriveCard
      render={{ id: "render-1", label: "Bản cuối 1080×1920 · kịch bản v2", outdated: false }}
      archive={archive()}
      driveConnected
      {...props}
    />,
  );

describe("DriveCard", () => {
  it("explains what will happen before there is a finished render, draft or final", () => {
    const html = card({ render: null, archive: null });

    expect(html).toContain("Bản nháp và bản cuối tự được lưu lên Google Drive");
    expect(html).toContain("Chưa có bản render nào hoàn tất");
    expect(hrefs(html)).not.toContain("/settings");
  });

  it("points to the settings when nothing can be saved because Drive is not connected", () => {
    expect(hrefs(card({ render: null, archive: null, driveConnected: false }))).toContain("/settings");
    const withRender = card({ archive: null, driveConnected: false });
    expect(withRender).toContain("chưa kết nối Google Drive");
    expect(hrefs(withRender)).toContain("/settings");
    expect(withRender).not.toContain("Lưu lên Drive");
  });

  it("offers to save a render that has no archive when Drive is connected", () => {
    const html = card({ archive: null });

    expect(html).toContain("chưa được lưu lên Drive");
    expect(html).toContain("Lưu lên Drive");
  });

  it("gives every way into a saved video: open it, copy its link, open its folder", () => {
    const html = card();

    expect(html).toContain("Đã lưu Drive");
    expect(html).toContain("Bản cuối 1080×1920 · kịch bản v2");
    expect(html).toContain("Mở video trên Drive");
    expect(html).toContain("Sao chép link");
    expect(html).toContain("Mở thư mục Drive");
    expect(hrefs(html)).toEqual([VIDEO_URL, FOLDER_URL]);
  });

  it("links the video as soon as it is there while the rest of the archive is still going up", () => {
    const html = card({
      archive: archive({
        status: "RUNNING",
        folderUrl: null,
        files: [file("VIDEO", "VERIFIED"), file("SCRIPT", "UPLOADING"), file("MANIFEST", "PENDING")],
      }),
    });

    expect(html).toContain("Đang lưu Drive");
    expect(html).toContain("1/3 tệp đã xác minh");
    expect(hrefs(html)).toEqual([VIDEO_URL]);
  });

  it("gives the reason and a retry when saving failed, but no retry without a connection", () => {
    const failed = archive({
      status: "FAILED",
      errorMessage: "Drive hết dung lượng.",
      folderUrl: null,
      videoUrl: null,
    });

    const connected = card({ archive: failed });
    expect(connected).toContain("Lưu Drive lỗi");
    expect(connected).toContain("Drive hết dung lượng.");
    expect(connected).toContain("Thử lại lưu Drive");
    expect(card({ archive: failed, driveConnected: false })).not.toContain("Thử lại lưu Drive");
  });

  it("says when the copy on Drive comes from an older script", () => {
    expect(card({ render: { id: "render-1", label: "Bản cuối", outdated: true } })).toContain("kịch bản cũ");
  });
});
