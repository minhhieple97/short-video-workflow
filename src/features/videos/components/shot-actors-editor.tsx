"use client";

import { Label } from "@/components/ui/label";

import type { CastSnapshot } from "../domain/characters";
import { CHARACTER_ACTION_LABELS, CHARACTER_ACTIONS } from "../domain/illustration";
import type { PlannedShot } from "../domain/shot-plan";

export function ShotActorsEditor({
  id,
  cast,
  shot,
  onChange,
  disabled,
}: Readonly<{
  id: string;
  cast: CastSnapshot;
  shot: PlannedShot;
  onChange: (next: PlannedShot) => void;
  disabled: boolean;
}>) {
  const actors = shot.actors?.length
    ? shot.actors
    : [{ characterId: cast.primaryCharacterId, action: shot.action ?? ("THINKING" as const) }];
  return (
    <div className="flex flex-wrap gap-3">
      {[0, 1].map((slot) => (
        <div key={slot} className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`${id}-actor-${slot}`}>
              Người {slot + 1}
            </Label>
            <select
              id={`${id}-actor-${slot}`}
              disabled={disabled}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={actors[slot]?.characterId ?? ""}
              onChange={(event) => {
                const characterId = event.target.value;
                const next = [...actors];
                if (!characterId) next.splice(slot, 1);
                else next[slot] = { characterId, action: next[slot]?.action ?? "TALKING" };
                onChange({ ...shot, partner: undefined, actors: next });
              }}
            >
              <option value="" disabled={slot === 0}>
                Không có
              </option>
              {cast.profiles.map((profile) => (
                <option
                  key={profile.id}
                  value={profile.id}
                  disabled={actors.some((actor, index) => index !== slot && actor.characterId === profile.id)}
                >
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
          {actors[slot] ? (
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`${id}-actor-action-${slot}`}>
                Hành động
              </Label>
              <select
                id={`${id}-actor-action-${slot}`}
                disabled={disabled}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={actors[slot].action}
                onChange={(event) => {
                  const action = CHARACTER_ACTIONS.find((value) => value === event.target.value);
                  if (action)
                    onChange({
                      ...shot,
                      actors: actors.map((actor, index) => (index === slot ? { ...actor, action } : actor)),
                    });
                }}
              >
                {CHARACTER_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {CHARACTER_ACTION_LABELS[action]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
