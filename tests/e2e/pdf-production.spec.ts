import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { QUEUE_NAME } from "../../src/server/queue/constants";

import { buildPdf } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";
import { E2E_DATA_DIR, E2E_ENV } from "./stack";

// E2E-02, the v1.2 path a user sees: a PDF book becomes chapters and a lesson catalogue, the user picks a lesson without
// approving anything, and batch production makes a vertical video that ends up archived in (a fake) Google Drive.
test.skip(!popplerTestConfig(), "needs poppler-utils (or TEST_POPPLER_BIN_DIR)");

const BODY = [
  "Small habits make a big difference over a long time.",
  "Every action you take is a vote for the person you become.",
  "Make it obvious, make it attractive, make it easy to start.",
];

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

function videoFiles(suffix: string): string[] {
  const found: string[] = [];
  const stack = [path.join(E2E_DATA_DIR, "videos")];
  while (stack.length > 0) {
    const directory = stack.pop() ?? "";
    for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(suffix)) found.push(full);
    }
  }
  return found;
}

test("E2E-02: PDF → catalogue → chosen lesson → vertical video archived to Drive, with no approval step", async ({
  page,
}, testInfo) => {
  const pdfFile = testInfo.outputPath("sach-e2e.pdf");
  fs.writeFileSync(
    pdfFile,
    buildPdf([{ lines: ["Chapter 1", ...BODY] }, { lines: BODY }, { lines: ["Chapter 2", ...BODY] }]),
  );
  const mp4Before = new Set(videoFiles(".mp4"));
  const publishBefore = new Set(videoFiles("-publish.txt"));

  await test.step("upload the PDF and wait for its chapters", async () => {
    const connection = new Redis(E2E_ENV.REDIS_URL ?? "", { maxRetriesPerRequest: null });
    const queue = new Queue(QUEUE_NAME, { connection });
    await queue.pause();
    try {
      await open(page, "/books/import");
      await page.locator("#book-file").setInputFiles(pdfFile);
      await page.locator("#pdf-title").fill("Sách PDF E2E");
      await page.getByRole("button", { name: "Nhập 1 sách PDF" }).click();
      await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("button", { name: "Phân tích tất cả chương" })).toBeDisabled();
      await expect(
        page.getByText("Đang trích xuất PDF; chương sẽ xuất hiện khi trích xuất xong.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /^Sản xuất video/ })).toBeDisabled();
      const rejected = await page.request.post(`/api${new URL(page.url()).pathname}/analyze`);
      expect(rejected.status()).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: { code: "BOOK_HAS_NO_CHAPTERS" } });
    } finally {
      await queue.resume();
      await queue.close();
      connection.disconnect();
    }
    await expect(page.getByText("Đã trích xuất", { exact: true })).toBeVisible({ timeout: 120_000 });
    await page.reload();
    await expect(page.getByRole("tab", { name: /Chương \(2\)/ })).toBeVisible();
  });
  const bookUrl = page.url();

  await test.step("catalogue the chapters into lessons", async () => {
    let releaseErrorResponse: () => void = () => {};
    const responseReady = new Promise<void>((resolve) => {
      releaseErrorResponse = resolve;
    });
    await page.route("**/api/books/*/analyze", async (route) => {
      await responseReady;
      await route.fulfill({
        status: 503,
        json: { error: { code: "QUEUE_UNAVAILABLE", message: "Hàng đợi phân tích tạm thời không sẵn sàng." } },
      });
    });
    await page.getByRole("button", { name: "Phân tích tất cả chương" }).click();
    const submitting = page.getByRole("button", { name: "Đang xếp hàng…" });
    await expect(submitting).toBeDisabled();
    await expect(submitting).toHaveAttribute("aria-busy", "true");
    releaseErrorResponse();
    await expect(page.getByText("Hàng đợi phân tích tạm thời không sẵn sàng.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Phân tích tất cả chương" })).toBeEnabled();
    await page.unroute("**/api/books/*/analyze");
    await page.getByRole("button", { name: "Phân tích tất cả chương" }).click();
    await expect
      .poll(
        async () => {
          await open(page, bookUrl);
          return (await page.getByRole("tab", { name: /Bài học \(\d+\)/ }).textContent()) ?? "";
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .not.toContain("(0)");
  });

  await test.step("tick one lesson in the list as it is (still a draft) and make its video in one go", async () => {
    await open(page, `${bookUrl}?tab=lessons`);
    await page.locator("tbody tr").first().getByRole("checkbox").click();
    await page.getByRole("button", { name: "Tạo 1 video" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Tạo 1 video" }).click();
    await page.waitForURL(/\/productions\/[a-z0-9]+$/);
  });

  await test.step("the video is made and archived to Drive", async () => {
    // The page refreshes itself while items run; a failed item stops the wait with its reason.
    const badges = page.locator('[data-slot="badge"]');
    await expect
      .poll(
        async () => {
          const texts = await badges.allTextContents();
          if (texts.includes("Lỗi")) throw new Error(`Production failed: ${await page.locator("main").innerText()}`);
          return texts;
        },
        { timeout: 10 * 60_000, intervals: [3_000] },
      )
      .toEqual(expect.arrayContaining(["Hoàn tất", "Đã lưu Drive"]));
    await expect(page.getByRole("link", { name: /Thư mục Drive/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Video trên Drive/ })).toHaveAttribute(
      "href",
      /^https:\/\/drive\.google\.com\/file\/d\/[^/]+\/view$/,
    );
    // The script studio chose the length inside the default range and said why.
    await expect(page.getByText(/^AI đề xuất \d+ (giây|phút): .+/)).toBeVisible();
  });

  await test.step("the archive carries the title, caption and hashtags written with the scene plan", async () => {
    const [publish, ...others] = videoFiles("-publish.txt").filter((file) => !publishBefore.has(file));
    expect(others).toHaveLength(0);
    expect(fs.readFileSync(publish ?? "", "utf8")).toMatch(
      /^TIÊU ĐỀ\n.+\n\nCAPTION\n[\s\S]+\n\n#sachhay .*#booktok\n$/,
    );
  });

  await test.step("the render is a 9:16 H.264 + AAC MP4 and the lesson was never approved", async () => {
    const created = videoFiles(".mp4").filter((file) => !mp4Before.has(file));
    expect(created).toHaveLength(1);
    const probe = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height:format=duration",
        "-of",
        "json",
        created[0] ?? "",
      ]).toString(),
    ) as { streams: { codec_name: string; width?: number; height?: number }[]; format: { duration: string } };
    expect(probe.streams.map((stream) => stream.codec_name).sort()).toEqual(["aac", "h264"]);
    // Inside the default 30 s – 5 min range: readiness holds a batch video to the minimum.
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(30);
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(300);
    expect(probe.streams.find((stream) => stream.codec_name === "h264")).toMatchObject({ width: 1080, height: 1920 });

    await open(page, `${bookUrl}?tab=lessons`);
    await expect(page.getByText("Bản nháp").first()).toBeVisible();
    await expect(page.getByText("Đã duyệt")).toHaveCount(0);
  });
});
