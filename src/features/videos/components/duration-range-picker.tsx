"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { DURATION_PRESETS_SEC, formatPreset, isLongPreset, type DurationRange } from "../domain/duration";

// The user sets the lengths a video may have; the AI picks the one that suits the content inside them. The two ends never
// cross: moving one past the other takes the other along.
export function DurationRangePicker({
  id,
  value,
  onChange,
  ceilingSec,
  disabled = false,
}: Readonly<{
  id: string;
  value: DurationRange;
  onChange: (next: DurationRange) => void;
  ceilingSec: number;
  disabled?: boolean;
}>) {
  const options = DURATION_PRESETS_SEC.filter((seconds) => seconds <= ceilingSec);
  const pick = (end: "minDurationSec" | "maxDurationSec", raw: string) => {
    const seconds = Number(raw);
    if (end === "minDurationSec") {
      onChange({ minDurationSec: seconds, maxDurationSec: Math.max(seconds, value.maxDurationSec) });
    } else {
      onChange({ minDurationSec: Math.min(seconds, value.minDurationSec), maxDurationSec: seconds });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        {(
          [
            ["minDurationSec", "Ngắn nhất"],
            ["maxDurationSec", "Dài nhất"],
          ] as const
        ).map(([end, label]) => (
          <div key={end} className="flex flex-col gap-1">
            <Label htmlFor={`${id}-${end}`} className="text-muted-foreground text-xs">
              {label}
            </Label>
            <Select value={String(value[end])} onValueChange={(raw) => pick(end, raw)} disabled={disabled}>
              <SelectTrigger id={`${id}-${end}`} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {formatPreset(seconds)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        AI chọn độ dài hợp với nội dung trong khoảng này; bản cuối không được dài hơn mức dài nhất.
        {isLongPreset(value.maxDurationSec)
          ? " Video trên 60 giây có thể không còn được tính là Shorts/Reels trên một số nền tảng."
          : ""}
      </p>
    </div>
  );
}
