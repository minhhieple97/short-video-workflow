import { describe, expect, it } from "vitest";

import { formatDriveLinkLines } from "@/features/archive/domain/drive-link-lines";

const LINK = "https://drive.google.com/file/d/v/view";

describe("formatDriveLinkLines", () => {
  it("writes one line per video, title then a tab then the link, so a paste into a sheet makes two columns", () => {
    expect(
      formatDriveLinkLines([
        { title: "Thói quen nhỏ", videoUrl: `${LINK}1` },
        { title: "Môi trường tốt", videoUrl: `${LINK}2` },
      ]),
    ).toBe(`Thói quen nhỏ\t${LINK}1\nMôi trường tốt\t${LINK}2`);
  });

  it("leaves out videos that have no link yet, and says nothing when none has", () => {
    expect(
      formatDriveLinkLines([
        { title: "Chưa lên", videoUrl: null },
        { title: "Đã lên", videoUrl: LINK },
      ]),
    ).toBe(`Đã lên\t${LINK}`);
    expect(formatDriveLinkLines([{ title: "Chưa lên", videoUrl: null }])).toBe("");
    expect(formatDriveLinkLines([])).toBe("");
  });

  it("squeezes a title onto one line, because a tab or a line break inside it would break the columns", () => {
    expect(formatDriveLinkLines([{ title: "  Một\ttiêu đề\n  dài  ", videoUrl: LINK }])).toBe(
      `Một tiêu đề dài\t${LINK}`,
    );
  });
});
