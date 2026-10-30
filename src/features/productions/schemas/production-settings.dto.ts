import type { DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";

// What a screen that starts a production needs besides the lessons: where its form starts, the longest video this machine
// allows, and why production cannot run at all (null when it can).
export interface ProductionSettingsDto {
  defaultRange: DurationRange;
  defaultPace: Pace;
  ceilingSec: number;
  unavailable: string | null;
}

// The production a lesson is being made in right now, by lesson id.
export type ActiveProductionsByLesson = Readonly<Record<string, string>>;
