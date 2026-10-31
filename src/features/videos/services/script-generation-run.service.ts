import { aiSettingsSchema } from "@/features/settings/domain/ai-settings";
import { generationInputSchema } from "@/server/script-draft/contracts";
import { AppError } from "@/shared/errors";

import { scriptSourcePackSchema } from "../domain/script-source-pack";
import { findGenerationRun, saveGenerationSourceOnce } from "../repositories/script-generation-run.repository";
import { buildScriptSourcePack } from "./script-source-pack.service";

export async function requireGenerationRun(id: string) {
  const row = await findGenerationRun(id);
  if (!row) throw new AppError("SCRIPT_GENERATION_NOT_FOUND", "Không tìm thấy lần tạo kịch bản.", 404);
  return { row, settings: aiSettingsSchema.parse(row.settingsJson), input: generationInputSchema.parse(row.inputJson) };
}

export async function prepareGenerationRun(id: string) {
  let run = await requireGenerationRun(id);
  if (run.row.sourcePackJson === null) {
    const sourcePack = await buildScriptSourcePack(run.input.bookId, run.input.lessons);
    await saveGenerationSourceOnce(id, sourcePack);
    run = await requireGenerationRun(id);
  }
  const sourcePack = scriptSourcePackSchema.parse(run.row.sourcePackJson);
  if (sourcePack.bookId !== run.input.bookId)
    throw new AppError("SCRIPT_SOURCE_BOOK_MISMATCH", "Gói nguồn không thuộc sách của lần tạo kịch bản.", 409);
  return { ...run, sourcePack };
}
