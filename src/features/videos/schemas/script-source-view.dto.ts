import type { DraftBeatDto } from "@/features/productions/schemas/video-production.dto";

import type { CastSnapshot } from "../domain/characters";
import type { GenerationProvenance } from "../domain/generation-provenance";

export interface ScriptSourceViewDto {
  generation: GenerationProvenance;
  cast: CastSnapshot;
  // The model Claude Code reported doing each stage's work; null when it reported none (or the mock ran).
  actualModels: { script: string | null; scene: string | null };
  draft: DraftBeatDto[];
  edited: boolean;
  logic: {
    question: string;
    oldChoiceMotive: string;
    mechanism: string;
    changedActions: string[];
    observableResult: string;
    limits: string;
    sourceIds: string[];
  };
}
