import { lessonStatusHandler } from "@/server/http/lesson-status-route";

export const runtime = "nodejs";

export const POST = lessonStatusHandler("DRAFT");
