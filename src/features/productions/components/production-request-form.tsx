"use client";

import { Clapperboard } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LESSON_STATUS_LABELS } from "@/features/lessons/domain/lesson-fields";
import { DurationRangePicker } from "@/features/videos/components/duration-range-picker";
import { PaceSelect } from "@/features/videos/components/pace-select";
import { formatRange, type DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";
import { cn } from "@/lib/utils";

import type { CatalogueLessonDto } from "../schemas/catalogue.dto";
import type { ProductionSettingsDto } from "../schemas/production-settings.dto";
import { useStartProduction } from "./use-start-production";

// One video per chosen lesson. Choosing is the approval: a draft lesson becomes approved when the request is made, and
// the machine's checks approve each script after voicing, so nothing is approved by hand.
export function ProductionRequestForm({
  bookId,
  lessons,
  settings,
}: Readonly<{
  bookId: string;
  lessons: readonly CatalogueLessonDto[];
  settings: ProductionSettingsDto;
}>) {
  const { pending, start } = useStartProduction(bookId);
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState<DurationRange>(settings.defaultRange);
  const [pace, setPace] = useState<Pace>(settings.defaultPace);
  const { ceilingSec, unavailable } = settings;

  const selectable = useMemo(() => lessons.filter((lesson) => lesson.unavailableReason === null), [lessons]);
  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  const drafts = lessons.filter((lesson) => selected.includes(lesson.id) && lesson.status === "DRAFT").length;

  function toggle(id: string, checked: boolean): void {
    setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  // Items follow the catalogue order, whatever order the boxes were ticked in.
  const submit = () =>
    start({
      lessonIds: lessons.filter((lesson) => selected.includes(lesson.id)).map((lesson) => lesson.id),
      range: duration,
      pace,
    });

  return (
    <div className="flex flex-col gap-6">
      {unavailable ? (
        <Alert variant="destructive">
          <AlertDescription>{unavailable}</AlertDescription>
        </Alert>
      ) : null}
      <section aria-labelledby="catalogue-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="catalogue-heading" className="text-lg font-bold">
            Bài học ({selectable.length} có thể chọn)
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selectable.length === 0}
            onClick={() => setSelected(allSelected ? [] : selectable.map((lesson) => lesson.id))}
          >
            {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </Button>
        </div>
        <ul className="flex flex-col gap-3">
          {lessons.map((lesson) => {
            const disabled = lesson.unavailableReason !== null;
            const checkboxId = `lesson-${lesson.id}`;
            return (
              <li
                key={lesson.id}
                className={cn(
                  "bg-card shadow-card flex gap-3 rounded-2xl p-4",
                  selected.includes(lesson.id) && "ring-primary ring-2",
                  disabled && "opacity-70",
                )}
              >
                <Checkbox
                  id={checkboxId}
                  className="mt-1"
                  disabled={disabled}
                  checked={selected.includes(lesson.id)}
                  onCheckedChange={(checked) => toggle(lesson.id, checked === true)}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={checkboxId} className="font-semibold">
                      {lesson.title}
                    </label>
                    <Badge variant={lesson.status === "APPROVED" ? "mint" : "slate"}>
                      {LESSON_STATUS_LABELS[lesson.status]}
                    </Badge>
                    {lesson.usedInVideoCount > 0 ? (
                      <Badge variant="outline">Đã dùng trong {lesson.usedInVideoCount} video</Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-sm">{lesson.summary}</p>
                  {disabled ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">{lesson.unavailableReason}</p>
                  ) : (
                    <details className="text-sm">
                      <summary className="text-muted-foreground cursor-pointer">
                        Nguồn trong sách ({lesson.sources.length})
                      </summary>
                      <ul className="mt-2 flex flex-col gap-2">
                        {lesson.sources.map((source, index) => (
                          <li key={`${lesson.id}-${index}`} className="border-border border-l-2 pl-3">
                            <span title={source.chapterTitle} className="line-clamp-2 font-medium wrap-break-word">
                              {source.chapterTitle}
                            </span>
                            {source.page === null ? null : (
                              <span className="text-muted-foreground"> · trang {source.page}</span>
                            )}
                            <q className="text-muted-foreground mt-0.5 block">{source.excerpt}</q>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="preset-heading" className="flex flex-col gap-2">
        <h2 id="preset-heading" className="text-lg font-bold">
          Khoảng thời lượng mỗi video (9:16 · 1080×1920 · 30 FPS)
        </h2>
        <DurationRangePicker id="production-duration" value={duration} onChange={setDuration} ceilingSec={ceilingSec} />
      </section>

      <section aria-labelledby="pace-heading" className="flex flex-col gap-2">
        <h2 id="pace-heading" className="text-lg font-bold">
          Nhịp độ đọc
        </h2>
        <PaceSelect id="production-pace" value={pace} onChange={setPace} />
      </section>

      <div className="bg-card shadow-card sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <p className="text-sm">
          {selected.length === 0
            ? "Chọn ít nhất một bài học."
            : `${selected.length} bài học → ${selected.length} video, mỗi video ${formatRange(duration)}.${
                drafts > 0 ? ` ${drafts} bài đang là bản nháp sẽ được duyệt tự động.` : ""
              }`}
        </p>
        <Button onClick={() => void submit()} disabled={pending || selected.length === 0 || unavailable !== null}>
          <Clapperboard aria-hidden />
          Sản xuất {selected.length > 0 ? `${selected.length} video` : "video"}
        </Button>
      </div>
    </div>
  );
}
