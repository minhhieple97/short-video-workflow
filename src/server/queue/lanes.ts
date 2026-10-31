import type { JobType } from "@/shared/types/job";
import { workLaneSchema, type WorkLane } from "@/shared/types/work-lane";

// "general" keeps the queue name every job used before lanes existed, so jobs already waiting in Redis are still picked up
// (and moved to their own lane by the dispatcher).
export const LANE_QUEUE_NAMES: Record<WorkLane, string> = {
  general: "studio-jobs",
  claude: "studio-claude",
  notebooklm: "studio-notebooklm",
  voice: "studio-voice",
  render: "studio-render",
  archive: "studio-archive",
  extraction: "studio-extraction",
};

// The lane of a job whose payload names none. A chapter's analysis and a production item can belong to another lane, decided
// from the book and the item's checkpoint; whoever writes their job puts that lane in the payload.
const DEFAULT_LANES: Record<JobType, WorkLane> = {
  DIAGNOSTIC_PING: "general",
  ANALYZE_CHAPTER: "claude",
  GENERATE_VIDEO_SCRIPT: "claude",
  GENERATE_PUBLISH_METADATA: "claude",
  GENERATE_SCENE_TTS: "voice",
  RENDER_VIDEO: "render",
  RUN_PRODUCTION_ITEM: "general",
  ARCHIVE_RENDER: "archive",
  EXTRACT_PDF: "extraction",
};

export function laneForJob(jobType: JobType, data: Record<string, unknown>): WorkLane {
  const named = workLaneSchema.safeParse(data.lane);
  return named.success ? named.data : DEFAULT_LANES[jobType];
}

export function mapLanes<T>(make: (lane: WorkLane) => T): Record<WorkLane, T> {
  return {
    general: make("general"),
    claude: make("claude"),
    notebooklm: make("notebooklm"),
    voice: make("voice"),
    render: make("render"),
    archive: make("archive"),
    extraction: make("extraction"),
  };
}
