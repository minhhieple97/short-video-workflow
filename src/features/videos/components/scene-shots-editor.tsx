"use client";

import { Plus, RotateCcw, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";

import { maxShotsFor, shotPlanProblem, shotPlanSchema, type PlannedShot, type ShotPlan } from "../domain/shot-plan";
import type { SceneType } from "../domain/scene-types";
import { spokenTokens } from "../domain/word-timing";
import { ShotRow } from "./shot-row";
import type { CastSnapshot } from "../domain/characters";

// Why the shots cannot be saved as they are, or null.
export function shotsProblem(plan: ShotPlan | null, narration: string, sceneType: SceneType): string | null {
  if (!plan) return null;
  const parsed = shotPlanSchema.safeParse(plan);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Shot chưa hợp lệ.";
  return shotPlanProblem(parsed.data, narration, sceneType);
}

// The scene's shots under its one voice-over. Null is one shot showing the scene's picture, cut at its caption pages.
export function SceneShotsEditor({
  id,
  sceneType,
  narration,
  value,
  onChange,
  disabled,
  cast,
}: Readonly<{
  id: string;
  sceneType: SceneType;
  narration: string;
  value: ShotPlan | null;
  onChange: (next: ShotPlan | null) => void;
  disabled: boolean;
  cast?: CastSnapshot;
}>) {
  const words = spokenTokens(narration);
  const limit = maxShotsFor(sceneType);
  const problem = shotsProblem(value, narration, sceneType);
  const lastStart = value?.at(-1)?.fromWord ?? 0;
  // A new shot starts halfway through what the last one covers.
  const nextStart = lastStart + Math.max(1, Math.floor((words.length - lastStart) / 2));
  const canAdd = value !== null && value.length < limit && nextStart < words.length;
  const replace = (index: number, shot: PlannedShot) =>
    value && onChange(value.map((each, at) => (at === index ? shot : each)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm leading-none font-medium">
        Shot{value ? ` (${value.length}/${limit})` : " (một shot, cắt theo phụ đề)"}
      </legend>
      {value ? (
        <ol className="mt-1 flex flex-col gap-2">
          {value.map((shot, index) => (
            <ShotRow
              key={index}
              id={`${id}-shot-${index}`}
              index={index}
              shot={shot}
              words={words}
              firstWord={(value[index - 1]?.fromWord ?? -1) + 1}
              lastWord={(value[index + 1]?.fromWord ?? words.length) - 1}
              onChange={(next) => replace(index, next)}
              onRemove={() => onChange(value.filter((_, at) => at !== index))}
              disabled={disabled}
              cast={cast}
            />
          ))}
        </ol>
      ) : null}
      {problem ? <p className="text-xs text-red-600 dark:text-red-400">{problem}</p> : null}
      <div className="flex flex-wrap gap-1">
        {value === null ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || words.length === 0}
            onClick={() => onChange([{ fromWord: 0 }])}
          >
            <Scissors aria-hidden /> Chia shot
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || !canAdd}
              onClick={() => onChange([...value, { fromWord: nextStart }])}
            >
              <Plus aria-hidden /> Thêm shot
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
              <RotateCcw aria-hidden /> Về một shot
            </Button>
          </>
        )}
      </div>
    </fieldset>
  );
}
