"use client";

import { Clapperboard, Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { LessonStatus } from "@/features/lessons/domain/lesson-fields";
import { DurationRangePicker } from "@/features/videos/components/duration-range-picker";
import { PaceSelect } from "@/features/videos/components/pace-select";
import type { DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";

import type { ProductionSettingsDto } from "../schemas/production-settings.dto";
import { useStartProduction } from "./use-start-production";

export interface ProduceLesson {
  id: string;
  title: string;
  status: LessonStatus;
  usedInVideoCount: number;
}

export interface SkippedLesson {
  id: string;
  title: string;
  reason: string;
}

interface ProduceLessonsProps {
  bookId: string;
  // The lessons a click would make into videos, in the order of the list.
  lessons: readonly ProduceLesson[];
  // Ticked lessons that cannot be made, each with why.
  skipped: readonly SkippedLesson[];
  settings: ProductionSettingsDto;
}

function ProduceLessonsForm({ bookId, lessons, skipped, settings }: Readonly<ProduceLessonsProps>) {
  const { pending, start } = useStartProduction(bookId);
  const [range, setRange] = useState<DurationRange>(settings.defaultRange);
  const [pace, setPace] = useState<Pace>(settings.defaultPace);
  const alreadyMade = lessons.filter((lesson) => lesson.usedInVideoCount > 0).length;
  const drafts = lessons.filter((lesson) => lesson.status === "DRAFT").length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tạo {lessons.length} video tự động</DialogTitle>
        <DialogDescription>
          Mỗi bài học thành một video 9:16. Hệ thống tự viết bản thảo, biên tập cảnh, tạo giọng đọc, kiểm tra, duyệt
          kịch bản rồi render bản cuối (và lưu lên Drive nếu đã kết nối). Bài học được chọn cũng tự chuyển sang Đã
          duyệt, nên bạn không phải duyệt gì thêm.
        </DialogDescription>
      </DialogHeader>

      {settings.unavailable ? (
        <Alert variant="destructive">
          <AlertDescription>{settings.unavailable}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Bài học sẽ làm video ({lessons.length})</h3>
        <ol className="border-border flex max-h-44 flex-col gap-1 overflow-y-auto rounded-lg border p-2 text-sm">
          {lessons.map((lesson, index) => (
            <li key={lesson.id} className="flex gap-2">
              <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{index + 1}.</span>
              <span title={lesson.title} className="line-clamp-2 min-w-0 wrap-break-word">
                {lesson.title}
              </span>
            </li>
          ))}
        </ol>
        {drafts > 0 ? (
          <p className="text-muted-foreground text-xs">
            {drafts} bài đang là bản nháp sẽ được chuyển sang Đã duyệt khi bạn bấm tạo.
          </p>
        ) : null}
        {alreadyMade > 0 ? (
          <p className="text-muted-foreground text-xs">
            {alreadyMade} bài đã có video; vẫn tạo thêm video mới cho chúng.
          </p>
        ) : null}
      </section>

      {skipped.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Bỏ qua {skipped.length} bài đã chọn</h3>
          <ul className="text-muted-foreground flex max-h-28 flex-col gap-1 overflow-y-auto text-xs">
            {skipped.map((lesson) => (
              <li key={lesson.id}>
                <span title={lesson.title} className="text-foreground line-clamp-1 font-medium wrap-break-word">
                  {lesson.title}
                </span>
                <span className="block">{lesson.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Khoảng thời lượng mỗi video (dọc 9:16 · 1080×1920 · 30 FPS)</span>
        <DurationRangePicker id="produce-duration" value={range} onChange={setRange} ceilingSec={settings.ceilingSec} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Nhịp độ đọc</span>
        <PaceSelect id="produce-pace" value={pace} onChange={setPace} />
      </div>

      <p className="text-muted-foreground text-xs">
        Các video chạy lần lượt từng cái để máy không quá tải. Bạn theo dõi tiến độ ở trang Sản xuất và có thể rời đi,
        việc vẫn chạy nền.
      </p>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={pending}>
            Huỷ
          </Button>
        </DialogClose>
        <Button
          disabled={pending || lessons.length === 0 || settings.unavailable !== null}
          onClick={() => void start({ lessonIds: lessons.map((lesson) => lesson.id), range, pace })}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Clapperboard aria-hidden />}
          Tạo {lessons.length} video
        </Button>
      </DialogFooter>
    </>
  );
}

// Makes the ticked lessons into videos with no further steps by hand: one production, one video per lesson. The form is
// mounted only while the dialog is open, so each opening is a new request with its own key.
export function ProduceLessonsDialog(props: Readonly<ProduceLessonsProps>) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={props.lessons.length === 0}>
          <Clapperboard aria-hidden />
          {props.lessons.length > 0 ? `Tạo ${props.lessons.length} video` : "Tạo video"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <ProduceLessonsForm {...props} />
      </DialogContent>
    </Dialog>
  );
}
