import { getAppConfig, type AppConfig } from "@/shared/config/env";

import type { CheckResult } from "../types";

// Reads the configuration only: no request is sent to Mistral, and the key itself is never shown.
export function checkMistralOcr(config: Pick<AppConfig, "mistral" | "ocr"> = getAppConfig()): CheckResult {
  const { mistral, ocr } = config;
  const details = {
    Model: mistral.ocrModel,
    "Đơn giá (USD/1.000 trang)": mistral.usdPer1000Pages,
    "Trần chi phí mỗi sách (USD)": ocr.costCeilingMicroUsd / 1_000_000,
  };
  return mistral.apiKey
    ? {
        id: "mistral-ocr",
        label: "Mistral OCR",
        status: "ok",
        summary: "Đã cấu hình khoá API (chỉ worker đọc).",
        details,
      }
    : {
        id: "mistral-ocr",
        label: "Mistral OCR",
        status: "info",
        summary: "Chưa đặt MISTRAL_API_KEY: trang PDF scan sẽ không được OCR. Trang có sẵn chữ không cần OCR.",
        details,
      };
}
