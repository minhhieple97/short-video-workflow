"use client";

import { Clapperboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LESSON_STATUS_LABELS } from "@/features/lessons/domain/lesson-fields";
import { EXTENDED_PRESET_SEC, STANDARD_PRESETS_SEC } from "@/features/videos/domain/duration";
import { errorMessage, sendJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import type { CatalogueLessonDto } from "../schemas/catalogue.dto";
import type { ProductionDto } from "../schemas/production.dto";

// One video per chosen lesson. Choosing is not approving: the lessons keep their status, and the scripts are checked by
// the machine after voicing instead of by hand.
export function ProductionRequestForm({
  bookId,
  lessons,
}: Readonly<{ bookId: string; lessons: readonly CatalogueLessonDto[] }>) {
  const router = useRouter();
  // One key per visit of this form, so a double submit or a retry after a lost answer is the same request.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<string[]>([]);
  const [preset, setPreset] = useState<number>(60);
  const [extended, setExtended] = useState(false);
  const [pending, setPending] = useState(false);

  const selectable = useMemo(() => lessons.filter((lesson) => lesson.unavailableReason === null), [lessons]);
  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  function toggle(id: string, checked: boolean): void {
    setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  async function submit(): Promise<void> {
    setPending(true);
    try {
      // Items follow the catalogue order, whatever order the boxes were ticked in.
      const lessonIds = lessons.filter((lesson) => selected.includes(lesson.id)).map((lesson) => lesson.id);
      const production = await sendJson<ProductionDto & { reused: boolean }>("/api/productions", "POST", {
        bookId,
        lessonIds,
        idempotencyKey,
        targetDurationSec: extended ? EXTENDED_PRESET_SEC : preset,
        extended,
      });
      toast.success(`Đã xếp ${production.items.length} video vào hàng sản xuất.`);
      router.push(`/productions/${production.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
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
                            <span className="font-medium">{source.chapterTitle}</span>
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
          Thời lượng mỗi video (9:16 · 1080×1920 · 30 FPS)
        </h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset thời lượng">
          {STANDARD_PRESETS_SEC.map((seconds) => (
            <Button
              key={seconds}
              type="button"
              role="radio"
              aria-checked={!extended && preset === seconds}
              variant={!extended && preset === seconds ? "default" : "outline"}
              onClick={() => {
                setExtended(false);
                setPreset(seconds);
              }}
            >
              {seconds} giây{seconds === 60 ? " (mặc định)" : ""}
            </Button>
          ))}
        </div>
        <label className={cn("flex items-center gap-2 text-sm", extended && "font-medium")}>
          <Checkbox checked={extended} onCheckedChange={(checked) => setExtended(checked === true)} />
          Extended Short — 90 giây (chỉ khi nội dung thực sự cần)
        </label>
      </section>

      <div className="bg-card shadow-card sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <p className="text-sm">
          {selected.length === 0
            ? "Chọn ít nhất một bài học."
            : `${selected.length} bài học → ${selected.length} video ${extended ? EXTENDED_PRESET_SEC : preset} giây.`}
        </p>
        <Button onClick={() => void submit()} disabled={pending || selected.length === 0}>
          <Clapperboard aria-hidden />
          Sản xuất {selected.length > 0 ? `${selected.length} video` : "video"}
        </Button>
      </div>
    </div>
  );
}
