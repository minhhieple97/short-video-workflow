import { prisma } from "@/server/db/client";
import { AppError } from "@/shared/errors";

import { aiSettingsSchema, DEFAULT_AI_SETTINGS, type AiSettings } from "../domain/ai-settings";
import type { AiSettingsDto } from "../schemas/ai-settings.dto";

export async function readAiSettings(): Promise<AiSettingsDto> {
  const row = await prisma.aiGenerationSetting.findUnique({ where: { id: "default" } });
  return row
    ? { revision: row.revision, settings: aiSettingsSchema.parse(row.settingsJson) }
    : { revision: 0, settings: aiSettingsSchema.parse(DEFAULT_AI_SETTINGS) };
}

export async function saveAiSettings(revision: number, settings: AiSettings): Promise<AiSettingsDto> {
  return prisma.$transaction(async (tx) => {
    await tx.aiGenerationSetting.upsert({
      where: { id: "default" },
      create: { id: "default", revision: 0, settingsJson: DEFAULT_AI_SETTINGS },
      update: {},
    });
    const result = await tx.aiGenerationSetting.updateMany({
      where: { id: "default", revision },
      data: { settingsJson: settings, revision: { increment: 1 } },
    });
    if (!result.count)
      throw new AppError("AI_SETTINGS_CONFLICT", "Cài đặt đã thay đổi ở nơi khác. Hãy tải lại trang rồi lưu lại.", 409);
    return { revision: revision + 1, settings };
  });
}
