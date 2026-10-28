import { IntegrationError } from "@/server/integrations/integration-error";
import { getAppConfig, type AppConfig } from "@/shared/config/env";

import { MistralBatchOcrProvider } from "./mistral/mistral-batch-ocr-provider";
import { MistralClient } from "./mistral/mistral-client";
import type { OcrProvider } from "./ocr-provider";

// Mistral Batch is the only OCR provider today; a second one would be chosen here by configuration.
export function createOcrProvider(mistral: AppConfig["mistral"] = getAppConfig().mistral): OcrProvider {
  const { apiKey, baseUrl, ocrModel, usdPer1000Pages } = mistral;
  if (!apiKey) {
    throw new IntegrationError(
      "OCR_NOT_CONFIGURED",
      "Chưa cấu hình MISTRAL_API_KEY nên chưa thể chạy OCR.",
      "REJECTED",
    );
  }
  return new MistralBatchOcrProvider(new MistralClient({ apiKey, baseUrl }), { model: ocrModel, usdPer1000Pages });
}
