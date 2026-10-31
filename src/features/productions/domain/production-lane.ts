import type { WorkLane } from "@/shared/types/work-lane";

import type { ItemCheckpoint } from "./production-status";

// The lane that runs the step an item stands at. A step that holds a scarce resource runs in that resource's lane (the
// draft in Claude's for an item with a script generation run and in NotebookLM's for an older one, the scene plan in
// Claude's, the voice-over in the voice lane), so each lane's limit holds for production too; applying a plan, the
// readiness check and waiting on the render only touch the database.
export function productionLaneFor(checkpoint: ItemCheckpoint, opusDraft = false): WorkLane {
  switch (checkpoint) {
    case "NONE":
      return opusDraft ? "claude" : "notebooklm";
    case "DRAFTED":
      return "claude";
    case "APPLIED":
      return "voice";
    default:
      return "general";
  }
}
