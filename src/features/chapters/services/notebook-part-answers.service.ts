import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import {
  completeAiRun,
  failAiRun,
  findCompletedAiRun,
  startAiRun,
} from "@/features/jobs/repositories/ai-run.repository";
import { LESSON_EXTRACTION_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";
import { lessonExtractionSchema, type LessonExtraction } from "@/server/script-studio/script-studio-contracts";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("chapters.notebook-part-answers");
const PART_RUN_MODE = "notebooklm-part";

export interface PartQuestion {
  bookTitle: string;
  chapterTitle: string;
  partNumber: number;
  partCount: number;
  pages: { first: number; last: number };
  markdown: string;
}

// Everything one question about a chapter part is answered from: the prompt's version, the titles and pages it names and
// the part's text (a new revision of the text is another question).
export function notebookPartInputHash({ markdown, ...named }: PartQuestion): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        promptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
        ...named,
        textHash: createHash("sha256").update(markdown, "utf8").digest("hex"),
      }),
    )
    .digest("hex");
}

async function readKeptAnswer(outputPath: string): Promise<LessonExtraction | null> {
  let json: unknown;
  try {
    json = JSON.parse(await fs.readFile(dataPath(outputPath), "utf8"));
  } catch (error) {
    logger.warn("Stored part answer could not be read", { outputPath, error: toSafeErrorMessage(error) });
    return null;
  }
  const answer = lessonExtractionSchema.safeParse(json);
  // An answer that stopped early is asked again rather than settled for.
  return answer.success && answer.data.complete ? answer.data : null;
}

// Answers one part's question, from an answer given earlier when there is one, otherwise by `ask`, whose answer is kept
// with how long it took (or why it failed). A part answered by an attempt that failed later is not asked again by the next
// attempt, but once an analysis of the chapter has finished (`analyzedAt`) its answers are spent, so a forced run asks anew.
export async function answerPart(request: {
  question: PartQuestion;
  analyzedAt: Date | null;
  jobRecordId: string | null;
  taskDir: string;
  ask: () => Promise<LessonExtraction>;
}): Promise<{ extraction: LessonExtraction; reused: boolean }> {
  const inputHash = notebookPartInputHash(request.question);
  const earlier = await findCompletedAiRun({
    mode: PART_RUN_MODE,
    inputHash,
    completedAfter: request.analyzedAt,
  });
  const kept = earlier?.outputPath ? await readKeptAnswer(earlier.outputPath) : null;
  if (kept) return { extraction: kept, reused: true };

  const run = await startAiRun({
    jobRecordId: request.jobRecordId,
    mode: PART_RUN_MODE,
    promptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
    inputHash,
  });
  try {
    const extraction = await request.ask();
    const outputPath = `${request.taskDir}/notebooklm-part-${request.question.partNumber}-${inputHash.slice(0, 12)}.json`;
    await writeFileAtomic(dataPath(outputPath), `${JSON.stringify(extraction, null, 2)}\n`);
    await completeAiRun(run.id, outputPath);
    return { extraction, reused: false };
  } catch (error) {
    await failAiRun(run.id, toSafeErrorMessage(error));
    throw error;
  }
}
