import "server-only";

import { findActiveItemsForLessons } from "../repositories/production.repository";
import type { ActiveProductionsByLesson } from "../schemas/production-settings.dto";

// The production each of these lessons is being made in right now (lesson id → production id), so a list can show it and
// leave it out of a new request instead of making the same video twice at once.
export async function getActiveProductionsByLesson(lessonIds: readonly string[]): Promise<ActiveProductionsByLesson> {
  if (lessonIds.length === 0) return {};
  const byLesson: Record<string, string> = {};
  for (const item of await findActiveItemsForLessons(lessonIds)) byLesson[item.lessonId] ??= item.batchId;
  return byLesson;
}
