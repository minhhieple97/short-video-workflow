"use client";

import { describePace, formatSpeedPercent, PACES, paceProfile, type Pace } from "../domain/pace";

// One choice for how fast a video is read: the voice, the pause between scenes and how many words the AI writes all
// follow it. Native radios, so the arrow keys and screen readers work as they do everywhere.
export function PaceSelect({
  id,
  value,
  onChange,
  disabled = false,
}: Readonly<{ id: string; value: Pace; onChange: (next: Pace) => void; disabled?: boolean }>) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">Nhịp độ đọc</legend>
      <div className="grid grid-cols-3 gap-2">
        {PACES.map((pace) => {
          const profile = paceProfile(pace);
          return (
            <label
              key={pace}
              className="border-border bg-card has-checked:border-primary has-checked:bg-tone-violet has-focus-visible:ring-ring/50 has-disabled:opacity-50 flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-sm has-focus-visible:ring-3"
            >
              <input
                type="radio"
                name={id}
                value={pace}
                checked={value === pace}
                onChange={() => onChange(pace)}
                className="sr-only"
              />
              <span className="font-semibold">{profile.label}</span>
              <span className="text-muted-foreground text-xs">Giọng {formatSpeedPercent(profile.speedPercent)}</span>
            </label>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {describePace(value)}
      </p>
    </fieldset>
  );
}
