import "server-only";

import type { LessonStatus } from "@/features/lessons/domain/lesson-fields";
import { changeLessonStatus } from "@/features/lessons/services/lesson.service";

import { errorResponse, type RouteContext } from "./route-helpers";

export function lessonStatusHandler(status: LessonStatus) {
  return async function POST(_request: Request, context: RouteContext<{ lessonId: string }>): Promise<Response> {
    try {
      const { lessonId } = await context.params;
      return Response.json(await changeLessonStatus(lessonId, status));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
