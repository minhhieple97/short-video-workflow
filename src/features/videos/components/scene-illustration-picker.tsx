"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  CHARACTER_ACTION_LABELS,
  CHARACTER_ACTIONS,
  DEFAULT_ILLUSTRATION,
  ILLUSTRATION_SETTING_LABELS,
  ILLUSTRATION_SETTINGS,
  type Illustration,
} from "../domain/illustration";
import type { SceneType } from "../domain/scene-types";

// Null means the scene uses the default picture for its type; the selects still show what that default is.
export function SceneIllustrationPicker({
  id,
  sceneType,
  value,
  onChange,
  disabled,
}: Readonly<{
  id: string;
  sceneType: SceneType;
  value: Illustration | null;
  onChange: (next: Illustration | null) => void;
  disabled: boolean;
}>) {
  const shown = value ?? DEFAULT_ILLUSTRATION[sceneType];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm leading-none font-medium">Hoạt cảnh{value ? "" : " (mặc định theo loại cảnh)"}</legend>
      <div className="mt-1 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-setting`} className="text-muted-foreground text-xs">
            Bối cảnh
          </Label>
          <Select
            value={shown.setting}
            onValueChange={(setting) => {
              const next = ILLUSTRATION_SETTINGS.find((candidate) => candidate === setting);
              if (next) onChange({ ...shown, setting: next });
            }}
            disabled={disabled}
          >
            <SelectTrigger id={`${id}-setting`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ILLUSTRATION_SETTINGS.map((setting) => (
                <SelectItem key={setting} value={setting}>
                  {ILLUSTRATION_SETTING_LABELS[setting]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-action`} className="text-muted-foreground text-xs">
            Nhân vật đang
          </Label>
          <Select
            value={shown.action}
            onValueChange={(action) => {
              const next = CHARACTER_ACTIONS.find((candidate) => candidate === action);
              if (next) onChange({ ...shown, action: next });
            }}
            disabled={disabled}
          >
            <SelectTrigger id={`${id}-action`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHARACTER_ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {CHARACTER_ACTION_LABELS[action]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {value ? (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            <RotateCcw aria-hidden /> Về mặc định
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
