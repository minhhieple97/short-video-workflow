import { expect, test, type Response } from "@playwright/test";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { QUEUE_NAME } from "../../src/server/queue/constants";
import { buildPdf } from "../helpers/pdf-fixtures";
import { E2E_ENV } from "./stack";

const pdf = (name: string) => ({
  name: `${name}.pdf`,
  mimeType: "application/pdf",
  buffer: buildPdf([
    {
      lines: [
        "Chapter 1",
        name,
        "Small habits make a difference over a long time.",
        "Make it obvious and easy to start every day.",
      ],
    },
  ]),
});

test("unified import: one page, PDF modes, validation and accessible icon actions", async ({ page }) => {
  await page.goto("/books/import/batch");
  await page.waitForURL(/\/books\/import\?auto=1$/);
  await expect(page.getByRole("heading", { name: "Nhập sách", exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Nhập nhiều PDF tự động" })).toHaveCount(0);
  await page.locator("#book-file").setInputFiles(pdf("mode-check"));
  await expect(page.getByRole("radio", { name: /^Tự động làm video/ })).toBeChecked();
  await expect(page.getByLabel("Ngắn nhất", { exact: true })).toBeVisible();
  await page.getByLabel("Ngắn nhất", { exact: true }).click();
  await page.getByRole("option", { name: "60 giây", exact: true }).click();
  await page.getByText("Nhanh", { exact: true }).click();
  await page.getByRole("radio", { name: /^Chỉ nhập sách/ }).check();
  await expect(page.getByLabel("Ngắn nhất", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Nhập 1 sách PDF", exact: true })).toHaveText("");
  await page.locator("#book-file").setInputFiles([pdf("first"), pdf("second")]);
  await expect(page.getByRole("button", { name: "Nhập 2 sách PDF", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /^Tự động làm video/ }).check();
  await expect(page.getByLabel("Ngắn nhất", { exact: true })).toHaveText("60 giây");
  await expect(page.locator('input[name="batch-pace"][value="FAST"]')).toBeChecked();
  await expect(page.getByRole("button", { name: "Nhập và tự động làm video cho 2 sách", exact: true })).toHaveText("");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("#book-file").setInputFiles(Array.from({ length: 16 }, (_, i) => pdf(`limit-${i}`)));
  await expect(page.getByText("Tối đa 15 tệp PDF mỗi lần nhập.", { exact: true })).toBeVisible();
  await page
    .locator("#book-file")
    .setInputFiles([pdf("mixed"), { name: "book.txt", mimeType: "text/plain", buffer: Buffer.from("A book") }]);
  await expect(page.getByText(/Chọn nhiều tệp chỉ áp dụng cho PDF/)).toBeVisible();
  await page.locator("#book-file").setInputFiles({
    name: `${"a".repeat(240)}.zip`,
    mimeType: "application/zip",
    buffer: Buffer.from("unsupported"),
  });
  const selectionError = page.getByRole("alert").filter({ hasText: "không được hỗ trợ" });
  await expect(selectionError).toContainText("không được hỗ trợ");
  expect(
    await selectionError.evaluate(
      (element) =>
        element.getBoundingClientRect().right <= window.innerWidth && element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "Dán văn bản", exact: true }).click();
  await page.getByLabel("Nội dung sách", { exact: true }).fill("Chapter 1\nSmall habits matter every day.");
  await expect(page.getByRole("button", { name: "Phân tích cấu trúc chương", exact: true })).toBeEnabled();
});

test("unified import: multiple PDFs can enter the library without automatic videos", async ({ page }) => {
  const connection = new Redis(E2E_ENV.REDIS_URL ?? "", { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.pause();
  const uploaded: Response[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/books/import/pdf" && response.status() === 202) {
      uploaded.push(response);
    }
  });
  try {
    await page.goto("/books/import");
    await page.waitForLoadState("networkidle");
    const stamp = Date.now();
    await page.locator("#book-file").setInputFiles([pdf(`library-first-${stamp}`), pdf(`library-second-${stamp}`)]);
    await expect(page.getByRole("radio", { name: /^Chỉ nhập sách/ })).toBeChecked();
    await expect(page.getByLabel("Ngắn nhất", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Nhập 2 sách PDF", exact: true }).click();
    await page.waitForURL(/\/books$/);
    expect(uploaded).toHaveLength(2);
    for (const response of uploaded) {
      const book = (await response.json()) as { bookId: string };
      await expect(page.locator(`a[href="/books/${book.bookId}"]`)).toBeVisible();
    }
  } finally {
    await queue.resume();
    await queue.close();
    connection.disconnect();
  }
});

test("unified import: retrying a failed PDF keeps the books already uploaded", async ({ page }) => {
  const attempts: string[] = [];
  await page.route("**/api/books/import/pdf?**", async (route) => {
    const name = new URL(route.request().url()).searchParams.get("fileName") ?? "";
    attempts.push(name);
    const failed = name === "retry-second.pdf" && attempts.filter((file) => file === name).length === 1;
    await route.fulfill({
      status: failed ? 422 : 202,
      json: failed ? { error: { code: "PDF_CORRUPT", message: "Tệp PDF bị hỏng." } } : { bookId: name },
    });
  });
  await page.goto("/books/import");
  await page.waitForLoadState("networkidle");
  await page.locator("#book-file").setInputFiles([pdf("retry-first"), pdf("retry-second")]);
  await page.getByRole("button", { name: "Nhập 2 sách PDF", exact: true }).click();
  await expect(page.getByText("retry-second.pdf: Tệp PDF bị hỏng.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Đã nhập 1\/2 sách/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Thay đổi tệp", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Nhập 2 sách PDF", exact: true }).click();
  await page.waitForURL(/\/books$/);
  expect(attempts).toEqual(["retry-first.pdf", "retry-second.pdf", "retry-second.pdf"]);
});
