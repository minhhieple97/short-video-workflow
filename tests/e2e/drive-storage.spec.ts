import { expect, test } from "@playwright/test";

test("Drive storage: refresh real endpoint, distinguish metrics, and retain data on failure", async ({ page }) => {
  await page.goto("/settings");
  const refresh = page.getByRole("button", { name: "Đọc lại từ Google", exact: true });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.getByText("30 TiB", { exact: true })).toBeVisible();
  await expect(page.getByText("433,9 MiB", { exact: true })).toBeVisible();
  await expect(page.getByText("Tổng dung lượng Google đã dùng", { exact: true })).toBeVisible();
  await page.getByText("Số liệu gốc từ API (byte)", { exact: true }).click();
  await expect(page.getByText("Giới hạn lưu trữ Google: 32985348833280 byte", { exact: true })).toBeVisible();
  await expect(page.getByText("Riêng tệp Google Drive: 455028138 byte", { exact: true })).toBeVisible();
  await page.route("**/api/integrations/drive/capacity/refresh", async (route) => {
    await route.fulfill({
      status: 503,
      json: { error: { code: "GOOGLE_TRANSPORT", message: "Google tạm thời không phản hồi." } },
    });
  });
  await refresh.click();
  await expect(page.getByRole("alert").filter({ hasText: "Google tạm thời không phản hồi." })).toBeVisible();
  await expect(page.getByText("30 TiB", { exact: true })).toBeVisible();
  await expect(refresh).toBeEnabled();
});
