import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { HOOK_MAX_SECONDS } from "../../src/features/videos/domain/duration";
import { E2E_DATA_DIR } from "./stack";

const SAMPLE_BOOK = path.join(process.cwd(), "prisma/seed-data/atomic-habits-sample.md");

interface SceneJson {
  id: string;
  narration: string;
  version: number;
  shots: { fromWord: number; mood?: string }[] | null;
}

interface RenderJson {
  quality: "DRAFT" | "FINAL";
  status: string;
  fileUrl: string | null;
}

function probe(file: string) {
  const output = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name,width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    file,
  ]).toString();
  return JSON.parse(output) as {
    streams: { codec_name: string; width?: number; height?: number; r_frame_rate: string }[];
    format: { duration: string };
  };
}

// Inputs changed before React hydrates are lost (the button below would stay disabled), so wait until the
// page's scripts have settled; this matters when the machine is busy.
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

// The video may run from 30 seconds up to `longest`; the AI picks its length inside that range with the script. Several
// lessons are joined into this one video by choosing so: left alone, the dialog makes one video for each of them.
async function createVideo(
  page: Page,
  bookUrl: string,
  lessonIndexes: number[],
  longest: string,
  pace: "Chuẩn" | "Nhanh" | "Rất nhanh" = "Chuẩn",
): Promise<string> {
  await open(page, `${bookUrl}?tab=videos`);
  await page.getByRole("button", { name: "Tạo video" }).click();
  const dialog = page.getByRole("dialog");
  for (const index of lessonIndexes) await dialog.getByRole("checkbox").nth(index).click();
  if (lessonIndexes.length > 1) await dialog.getByText("Ghép thành một video", { exact: true }).click();
  await dialog.getByLabel("Dài nhất").click();
  await page.getByRole("option", { name: longest, exact: true }).click();
  await dialog.getByText(pace, { exact: true }).click();
  await dialog.getByRole("button", { name: "Tạo video" }).click();
  await page.waitForURL(/\/videos\/[a-z0-9]+$/);
  return page.url();
}

async function generateScript(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Tạo kịch bản" }).click();
  await expect(page.getByRole("button", { name: "Dùng hook này" }).first()).toBeVisible({ timeout: 90_000 });
}

test("E2E-01: one book, several short videos, rendered as vertical MP4", async ({ page, request }) => {
  await test.step("import the sample book with a renamed chapter", async () => {
    await open(page, "/books/import");
    const analyse = page.getByRole("button", { name: "Phân tích cấu trúc chương" });
    await expect(async () => {
      await page.locator("#book-file").setInputFiles(SAMPLE_BOOK);
      await expect(analyse).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await analyse.click();
    await expect(page.getByText(/Danh sách chương/)).toBeVisible();
    await page.getByLabel("Tên mục 4").fill("Chương 1: Thay đổi nhỏ (đã đổi tên)");
    await page.locator("#import-author").fill("James Clear");
    await page.getByRole("button", { name: /Xác nhận nhập 3 chương/ }).click();
    await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Chương 1: Thay đổi nhỏ (đã đổi tên)")).toBeVisible();
  });
  const bookUrl = page.url();

  await test.step("analyse a ticked chapter first, then the rest, with the mock AI", async () => {
    await page.waitForLoadState("networkidle");
    const second = page.getByRole("checkbox", { name: "Chọn chương 2 để phân tích" });
    await second.click();
    await expect(second).toBeChecked();
    await page.getByRole("button", { name: "Phân tích 1 chương đã chọn" }).click();
    await expect(page.locator("tbody tr").filter({ hasText: "Đã phân tích" })).toHaveCount(1, { timeout: 90_000 });
    // An analysed chapter is not offered again, and the ticks are gone.
    await expect(second).toBeDisabled();
    await expect(second).not.toBeChecked();
    await page.getByRole("button", { name: "Phân tích 2 chương còn lại" }).click();
    await expect(page.locator("tbody tr").filter({ hasText: "Đã phân tích" })).toHaveCount(3, { timeout: 90_000 });
  });

  const lessonHrefs =
    await test.step("approve three lessons: one on its page, two together from the list", async () => {
      await open(page, `${bookUrl}?tab=lessons`);
      const hrefs = await page
        .locator("tbody a")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      await open(page, hrefs[0] ?? "");
      await page.getByRole("button", { name: "Duyệt", exact: true }).click();
      await expect(page.getByText("Đã duyệt bài học.")).toBeVisible();

      await open(page, `${bookUrl}?tab=lessons`);
      const rows = page.locator("tbody tr");
      await rows.nth(2).getByRole("checkbox").click();
      await rows.nth(4).getByRole("checkbox").click();
      await expect(page.getByText("Đã chọn 2 bài học")).toBeVisible();
      await page.getByRole("button", { name: "Duyệt 2 bài" }).click();
      await expect(page.getByText("Đã duyệt 2 bài học.")).toBeVisible();
      await expect(rows.filter({ hasText: "Đã duyệt" })).toHaveCount(3);
      await expect(page.getByText("Chọn bài học để duyệt, từ chối hoặc tạo video cùng lúc.")).toBeVisible();
      return hrefs;
    });

  await test.step("reject a lesson from the list after a confirmation, then bring it back to draft", async () => {
    await open(page, `${bookUrl}?tab=lessons`);
    const sixth = page.locator("tbody tr").nth(5);
    await sixth.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Từ chối 1 bài" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Từ chối", exact: true }).click();
    await expect(page.getByText("Đã từ chối 1 bài học.")).toBeVisible();
    await expect(sixth).toContainText("Đã lưu trữ");

    await sixth.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Trả về nháp 1 bài" }).click();
    await expect(page.getByText("Đã chuyển 1 bài học về bản nháp.")).toBeVisible();
    await expect(sixth).toContainText("Bản nháp");
  });

  const videoA = await test.step("create video A (one lesson, up to 60 s, fastest pace) and pick a hook", async () => {
    const url = await createVideo(page, bookUrl, [0], "60 giây", "Rất nhanh");
    const created = (await (await request.get(`/api/videos/${url.split("/").at(-1) ?? ""}`)).json()) as {
      pace: string;
    };
    expect(created.pace).toBe("FASTER");
    await expect(page.getByText("Khoảng 30 giây – 60 giây")).toBeVisible();
    await generateScript(page);
    await expect(page.getByText(/^AI đề xuất (30|45|60) giây · 30 giây – 60 giây$/)).toBeVisible();
    await page.getByRole("button", { name: "Dùng hook này" }).first().click();
    await expect(page.getByText("Đã chọn hook.")).toBeVisible();
    await expect(page.getByText(/Đạt — HOOK bắt đầu tại frame 0/)).toBeVisible();
    return url;
  });

  await test.step("the script came with a title, caption and hashtags that can be edited and saved", async () => {
    await open(page, `${videoA}?tab=publish`);
    const title = page.getByLabel("Tiêu đề", { exact: true });
    await expect(title).not.toHaveValue("");
    await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(/Sách: .+ – James Clear/);
    await expect(page.getByText("AI viết", { exact: true })).toBeVisible();
    await title.fill("Bắt đầu từ một việc thật nhỏ");
    await page.getByLabel("Hashtag", { exact: true }).fill("#SáchHay #ThóiQuen #booktok");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByText("Đã lưu tiêu đề, caption và hashtag.")).toBeVisible();
    await expect(page.getByText("Đã sửa tay", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Hashtag", { exact: true })).toHaveValue("#sachhay #thoiquen #booktok");
  });

  await test.step("create video B (two lessons, up to 90 s) and edit one scene only", async () => {
    const url = await createVideo(page, bookUrl, [1, 2], "90 giây");
    await expect(page.getByText("Khoảng 30 giây – 90 giây")).toBeVisible();
    await generateScript(page);
    const videoId = url.split("/").at(-1) ?? "";
    const before = (await (await request.get(`/api/videos/${videoId}`)).json()) as { scenes: SceneJson[] };

    await open(page, `${url}?tab=story`);
    await page
      .locator("textarea[id$='-narration']")
      .nth(1)
      .fill("Một người hứa tập thể dục mỗi tối nhưng bỏ cuộc sau ba ngày.");
    await page.getByRole("button", { name: "Lưu cảnh" }).and(page.locator(":enabled")).first().click();
    await expect(page.getByText("Đã lưu cảnh.")).toBeVisible();

    const after = (await (await request.get(`/api/videos/${videoId}`)).json()) as { scenes: SceneJson[] };
    expect(after.scenes[1]?.version).toBe((before.scenes[1]?.version ?? 0) + 1);
    expect(after.scenes.filter((_, index) => index !== 1)).toEqual(before.scenes.filter((_, index) => index !== 1));
    // The scene's shots moved onto the new words; changing one shot's face changes only the picture.
    expect(after.scenes[1]?.shots?.[0]?.fromWord).toBe(0);

    // A saved card is rebuilt from the saved scene, so start from a fresh page rather than race that refresh.
    await open(page, `${url}?tab=story`);
    await page.locator("[id$='-shot-0-mood']").first().click();
    await page.getByRole("option", { name: "Mệt mỏi" }).click();
    await page.getByRole("button", { name: "Lưu cảnh" }).and(page.locator(":enabled")).first().click();
    await expect
      .poll(async () => {
        const video = (await (await request.get(`/api/videos/${videoId}`)).json()) as { scenes: SceneJson[] };
        return [video.scenes[1]?.shots?.[0]?.mood, video.scenes[1]?.narration];
      })
      .toEqual(["TIRED", after.scenes[1]?.narration]);
  });

  await test.step("editing a lesson later does not change video A's snapshot", async () => {
    await open(page, lessonHrefs[0] ?? "");
    await page.locator("#lesson-title").fill("Tiêu đề bài học đã sửa sau khi tạo video");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.getByText("Đã lưu bài học.")).toBeVisible();
    await open(page, videoA);
    await expect(page.getByText("(đã sửa sau khi tạo video)")).toBeVisible();
  });

  await test.step("the phone preview stays docked beside the editor; upload narration for the hook", async () => {
    await open(page, videoA);
    const dock = page.getByRole("complementary", { name: "Xem trước video" });
    await expect(dock.getByRole("radiogroup", { name: "Nền tảng xem trước" })).toBeVisible();
    await expect(dock.getByRole("button", { name: `Xem ${HOOK_MAX_SECONDS} giây đầu` })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Xem trước" })).toHaveCount(0);

    // The Player swallows a render error into its fallback, so the controls above prove nothing about the picture.
    const { scenes } = (await (await request.get(`/api/videos/${videoA.split("/").at(-1) ?? ""}`)).json()) as {
      scenes: { onScreenText: string }[];
    };
    await expect(dock.getByText(scenes[0]?.onScreenText.split(/\s+/)[0] ?? "", { exact: true }).first()).toBeVisible();
    await expect(dock.getByText("Không phát được bản xem trước. Hãy tải lại trang.")).toHaveCount(0);

    const wav = path.join(E2E_DATA_DIR, "hook.wav");
    execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:duration=2",
      "-ar",
      "24000",
      wav,
    ]);
    await open(page, `${videoA}?tab=voice`);
    await expect(page.getByText(/nhịp Rất nhanh \(giọng \+30%\)/)).toBeVisible();
    await page.locator("input[type=file]").first().setInputFiles(wav);
    await expect(page.getByText("Đã tải âm thanh lên cho cảnh.")).toBeVisible();
    // Remotion's docked Player keeps its own pool of <audio> tags, so look only inside the voice tab.
    await expect(page.getByRole("tabpanel").locator("audio")).toHaveCount(1);
  });

  await test.step("approve the script, then render draft and final MP4", async () => {
    await open(page, videoA);
    await page.getByRole("button", { name: "Duyệt kịch bản" }).click();
    await expect(page.getByText("Kịch bản đã duyệt").first()).toBeVisible();

    await open(page, `${videoA}/render`);
    const videoId = videoA.split("/").at(-1) ?? "";
    const completed = async () => {
      const { renders } = (await (await request.get(`/api/videos/${videoId}/renders`)).json()) as {
        renders: RenderJson[];
      };
      return renders.filter((render) => render.status === "COMPLETED");
    };

    await page.getByRole("button", { name: /Render nháp/ }).click();
    await expect.poll(async () => (await completed()).length, { timeout: 6 * 60_000, intervals: [3_000] }).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: /Render bản cuối/ }).click();
    await expect.poll(async () => (await completed()).length, { timeout: 6 * 60_000, intervals: [3_000] }).toBe(2);

    for (const render of await completed()) {
      const file = path.join(E2E_DATA_DIR, `${render.quality}.mp4`);
      fs.writeFileSync(file, await (await request.get(render.fileUrl ?? "")).body());
      const info = probe(file);
      const video = info.streams.find((stream) => stream.codec_name === "h264");
      expect(info.streams.map((stream) => stream.codec_name).sort()).toEqual(["aac", "h264"]);
      expect(video).toMatchObject(
        render.quality === "FINAL"
          ? { width: 1080, height: 1920, r_frame_rate: "30/1" }
          : { width: 720, height: 1280, r_frame_rate: "30/1" },
      );
      expect(Number(info.format.duration)).toBeLessThanOrEqual(60);
    }
  });

  await test.step("the render page says both renders are on Drive and links to them, as do the video and its list", async () => {
    const driveFile = /^https:\/\/drive\.google\.com\/file\/d\/[^/]+\/view$/;
    // The render counts as finished a moment before the worker starts its archive, so a page opened in that gap shows
    // no archive yet; once there is one the page follows the upload by itself, from "Đang lưu Drive" to "Đã lưu Drive".
    const history = page.locator("tbody tr");
    await expect(async () => {
      await open(page, `${videoA}/render`);
      await expect(history.filter({ hasText: "Đã lưu Drive" })).toHaveCount(2, { timeout: 15_000 });
    }).toPass({ timeout: 120_000 });
    // The draft is saved like the final one, each from its own row of the history.
    for (const render of [/Nháp 720×1280/, /Bản cuối 1080×1920/]) {
      await expect(
        history.filter({ hasText: render }).getByRole("link", { name: /Mở video trên Drive/ }),
      ).toHaveAttribute("href", driveFile);
    }
    await expect(page.getByRole("link", { name: /Mở video trên Drive/ }).first()).toHaveAttribute("href", driveFile);
    await expect(page.getByRole("button", { name: "Sao chép link" })).toBeVisible();

    await open(page, videoA);
    await expect(page.getByText("Đã lưu Drive", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Mở video/ })).toHaveAttribute("href", driveFile);

    await open(page, `${bookUrl}?tab=videos`);
    const rows = page.locator("tbody tr");
    await expect(rows.filter({ hasText: "Đã lưu Drive" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Chưa render bản cuối" })).toHaveCount(1);
  });

  await test.step("everything is still there after a reload", async () => {
    await open(page, "/books");
    await expect(page.getByText("Atomic Habits — bản tóm lược minh họa")).toBeVisible();
    await open(page, `${bookUrl}?tab=videos`);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await open(page, `${bookUrl}?tab=lessons&status=APPROVED`);
    await expect(page.locator("tbody tr")).toHaveCount(3);
  });

  await test.step("two lessons ticked together become two videos, and the dialog shows both", async () => {
    await open(page, `${bookUrl}?tab=videos`);
    await page.getByRole("button", { name: "Tạo video" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").nth(0).click();
    await dialog.getByRole("checkbox").nth(1).click();
    await expect(dialog.getByRole("radio", { name: /Mỗi bài học một video/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Tạo 2 video" }).click();
    await expect(dialog.getByText("Đã tạo 2 video")).toBeVisible();
    await expect(dialog.getByRole("link")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Xong" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
  });

  await test.step("the dark theme can be chosen and is remembered", async () => {
    await open(page, "/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: "Giao diện tối" }).click();
    await expect(html).toHaveClass(/dark/);
    await open(page, "/books");
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "Giao diện tối" })).toHaveAttribute("aria-pressed", "true");
  });
});
