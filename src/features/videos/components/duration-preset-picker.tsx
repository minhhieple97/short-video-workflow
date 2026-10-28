"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import {
  DEFAULT_TARGET_SEC,
  formatPreset,
  LONG_PRESETS_SEC,
  STANDARD_PRESETS_SEC,
  type TargetDurationSec,
} from "../domain/duration";

export interface DurationChoice {
  targetDurationSec: TargetDurationSec;
  // True only when the user ticked "Video dài"; a long preset is never chosen for them.
  extended: boolean;
}

function PresetGroup({
  label,
  presets,
  choice,
  onPick,
}: Readonly<{
  label: string;
  presets: readonly TargetDurationSec[];
  choice: TargetDurationSec;
  onPick: (seconds: TargetDurationSec) => void;
}>) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {presets.map((seconds) => (
        <Button
          key={seconds}
          type="button"
          role="radio"
          aria-checked={choice === seconds}
          variant={choice === seconds ? "default" : "outline"}
          onClick={() => onPick(seconds)}
        >
          {formatPreset(seconds)}
          {seconds === DEFAULT_TARGET_SEC ? " (mặc định)" : ""}
        </Button>
      ))}
    </div>
  );
}

// Short presets up front; the long ones (up to five minutes) only after "Video dài" is ticked, and never beyond what
// MAX_VIDEO_DURATION_SEC allows on this machine.
export function DurationPresetPicker({
  value,
  onChange,
  maxDurationSec,
}: Readonly<{ value: DurationChoice; onChange: (next: DurationChoice) => void; maxDurationSec: number }>) {
  const longPresets = LONG_PRESETS_SEC.filter((seconds) => seconds <= maxDurationSec);
  return (
    <div className="flex flex-col gap-2">
      <PresetGroup
        label="Preset thời lượng"
        presets={STANDARD_PRESETS_SEC}
        choice={value.targetDurationSec}
        onPick={(seconds) => onChange({ targetDurationSec: seconds, extended: false })}
      />
      {longPresets.length > 0 ? (
        <>
          <label className={cn("flex items-center gap-2 text-sm", value.extended && "font-medium")}>
            <Checkbox
              checked={value.extended}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? { targetDurationSec: longPresets[0] ?? DEFAULT_TARGET_SEC, extended: true }
                    : { targetDurationSec: DEFAULT_TARGET_SEC, extended: false },
                )
              }
            />
            Video dài — tới {formatPreset(longPresets.at(-1) ?? DEFAULT_TARGET_SEC)} (chỉ khi nội dung thực sự cần)
          </label>
          {value.extended ? (
            <>
              <PresetGroup
                label="Preset video dài"
                presets={longPresets}
                choice={value.targetDurationSec}
                onPick={(seconds) => onChange({ targetDurationSec: seconds, extended: true })}
              />
              <p className="text-muted-foreground text-xs">
                Video trên 60 giây có thể không còn được tính là Shorts/Reels trên một số nền tảng. Vẫn là một bài học,
                kể sâu hơn.
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
