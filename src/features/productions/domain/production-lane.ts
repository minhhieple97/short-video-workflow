import type { WorkLane } from "@/shared/types/work-lane";

import type { ItemCheckpoint } from "./production-status";

// The lane that runs the step an item stands at. A step that holds a scarce resource runs in that resource's lane (the
// draft in NotebookLM's, the scene plan in Claude's, the voice-over in the voice lane), so each lane's limit holds for
// production too; applying a plan, the readiness check and waiting on the render only touch the database.
export function productionLaneFor(checkpoint: ItemCheckpoint): WorkLane {
  switch (checkpoint) {
    case "NONE":
      return "notebooklm";
    case "DRAFTED":
      return "claude";
    case "APPLIED":
      return "voice";
    default:
      return "general";
  }
}
