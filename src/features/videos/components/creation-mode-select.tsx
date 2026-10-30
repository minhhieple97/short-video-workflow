"use client";

import type { CreationMode } from "../domain/video-creation";

const OPTIONS: Record<CreationMode, { label: string; hint: (count: number) => string }> = {
  PER_LESSON: {
    label: "Mỗi bài học một video",
    hint: (count) => `Tạo ${count} video riêng, mỗi video mang tên bài học của nó. Khuyên dùng.`,
  },
  MERGED: {
    label: "Ghép thành một video",
    hint: (count) => `Một video dùng cả ${count} bài học; chỉ hợp khi các bài bổ trợ nhau.`,
  },
};

// With several lessons ticked, says whether they become several videos or one: the dialog used to join them silently,
// which looked like all but the first had been lost. Native radios, like the pace choice.
export function CreationModeSelect({
  id,
  value,
  onChange,
  lessonCount,
}: Readonly<{ id: string; value: CreationMode; onChange: (next: CreationMode) => void; lessonCount: number }>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Cách tạo</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(OPTIONS) as CreationMode[]).map((mode) => (
          <label
            key={mode}
            className="border-border bg-card has-checked:border-primary has-checked:bg-tone-violet has-focus-visible:ring-ring/50 flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-sm has-focus-visible:ring-3"
          >
            <input
              type="radio"
              name={id}
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              className="sr-only"
            />
            <span className="font-semibold">{OPTIONS[mode].label}</span>
            <span className="text-muted-foreground text-xs">{OPTIONS[mode].hint(lessonCount)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
