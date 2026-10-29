import fs from "node:fs";

import { expect, test } from "@playwright/test";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import type { BookImportDto } from "../../src/features/book-imports/schemas/book-import.dto";
import { QUEUE_NAME } from "../../src/server/queue/constants";
import { buildPdf } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";
import { E2E_ENV } from "./stack";

test.skip(!popplerTestConfig(), "needs poppler-utils");

test("E2E-03: two PDFs produce every lesson, one book at a time, through render and Drive", async ({
  page,
}, testInfo) => {
  const files = ["first", "second"].map((name) => {
    const file = testInfo.outputPath(`${name}.pdf`);
    fs.writeFileSync(
      file,
      buildPdf([
        {
          lines: [
            "Chapter 1",
            `A book about ${name} habits.`,
            "Small habits make a big difference over a long time.",
            "Every action you take is a vote for the person you become.",
            "Make it obvious and make it easy to start every day.",
          ],
        },
      ]),
    );
    return file;
  });
  const connection = new Redis(E2E_ENV.REDIS_URL ?? "", { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.pause();
  try {
    await page.goto("/books/import");
    await page.getByRole("link", { name: "Nhập nhiều PDF tự động" }).click();
    await page.locator("#batch-pdf-files").setInputFiles(files);
    await page.getByRole("button", { name: "Tải lên và tự động làm video cho 2 sách" }).click();
    await page.waitForURL(/\/book-imports\/[a-z0-9]+$/);
    await expect(page.getByText(/0\/2 sách hoàn tất/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("batch-mobile.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: testInfo.outputPath("batch-mobile-dark.png"), fullPage: true });
  } finally {
    await queue.resume();
    await queue.close();
    connection.disconnect();
  }
  const api = `/api${new URL(page.url()).pathname}`;
  let sawSequentialProduction = false;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(api);
        expect(response.ok()).toBe(true);
        const batch = (await response.json()) as BookImportDto;
        if (batch.items[0]?.status === "PRODUCING" && batch.items[1]?.status === "QUEUED")
          sawSequentialProduction = true;
        if (batch.status === "PARTIAL") throw new Error(JSON.stringify(batch.items));
        return batch.status;
      },
      { timeout: 12 * 60_000, intervals: [3_000] },
    )
    .toBe("COMPLETED");
  const batch = (await (await page.request.get(api)).json()) as BookImportDto;
  expect(sawSequentialProduction).toBe(true);
  expect(batch.items.map((item) => item.videosTotal)).toEqual([2, 2]);
  expect(batch.items.every((item) => item.videosCompleted === item.videosTotal)).toBe(true);
  const productionId = batch.items[1]?.productionIds[0];
  expect(productionId).toBeTruthy();
  await page.goto(`/productions/${productionId ?? ""}`);
  await expect(page.getByText("Đã lưu Drive", { exact: true })).toHaveCount(2);
});
