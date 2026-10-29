"use client";

import { Clapperboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { IconButton } from "@/components/layout/icon-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/api-client";

import { assessLessonLoad, type DurationRange } from "../domain/duration";
import type { VideoDetail } from "../schemas/video.dto";
import type { Pace } from "../domain/pace";
import { DurationRangePicker } from "./duration-range-picker";
import { PaceSelect } from "./pace-select";

export interface SelectableLesson {
  id: string;
  title: string;
  usedInVideoCount: number;
}

export function CreateVideoDialog({
  bookId,
  lessons,
  defaultRange,
  defaultPace,
  ceilingSec,
}: Readonly<{
  bookId: string;
  lessons: readonly SelectableLesson[];
  defaultRange: DurationRange;
  defaultPace: Pace;
  ceilingSec: number;
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<DurationRange>(defaultRange);
  const [pace, setPace] = useState<Pace>(defaultPace);
  const [pending, setPending] = useState(false);

  const load = assessLessonLoad(selected.length, duration.maxDurationSec);
  const reused = lessons.filter((lesson) => selected.includes(lesson.id) && lesson.usedInVideoCount > 0);
  const firstSelected = lessons.find((lesson) => lesson.id === selected[0]);

  function toggle(id: string, checked: boolean): void {
    setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  async function create(): Promise<void> {
    setPending(true);
    try {
      const { video, warnings } = await sendJson<{ video: VideoDetail; warnings: string[] }>("/api/videos", "POST", {
        bookId,
        title: title.trim() || firstSelected?.title || "Video mới",
        description,
        lessonIds: selected,
        ...duration,
        pace,
      });
      toast.success("Đã tạo video. Hãy tạo kịch bản.");
      warnings.forEach((warning) => toast.warning(warning));
      setOpen(false);
      router.push(`/videos/${video.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton
          label="Tạo video"
          note={lessons.length === 0 ? "Cần ít nhất một bài học đã duyệt" : undefined}
          disabled={lessons.length === 0}
        >
          <Clapperboard aria-hidden />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo video ngắn 9:16</DialogTitle>
          <DialogDescription>
            Khuyên dùng một bài học cho mỗi video; chỉ ghép thêm bài học khi chúng bổ trợ nhau.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Bài học đã duyệt</legend>
          {lessons.map((lesson) => (
            <label key={lesson.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={selected.includes(lesson.id)}
                onCheckedChange={(checked) => toggle(lesson.id, checked === true)}
              />
              <span>
                {lesson.title}
                {lesson.usedInVideoCount > 0 ? (
                  <span className="text-muted-foreground"> · đã dùng trong {lesson.usedInVideoCount} video</span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="video-title">Tiêu đề video</Label>
          <Input
            id="video-title"
            value={title}
            maxLength={200}
            placeholder={firstSelected?.title ?? "Ví dụ: Một thói quen nhỏ tạo thay đổi lớn"}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="video-description">Mô tả ngắn</Label>
          <Textarea
            id="video-description"
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Khoảng thời lượng (dọc 9:16 · 1080×1920 · 30 FPS)</span>
          <DurationRangePicker
            id="new-video-duration"
            value={duration}
            onChange={setDuration}
            ceilingSec={ceilingSec}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Nhịp độ đọc</span>
          <PaceSelect id="new-video-pace" value={pace} onChange={setPace} />
        </div>

        {selected.length > 0 ? (
          <Alert variant={load.level === "overload" ? "destructive" : "default"}>
            <AlertDescription>
              {load.message}
              {reused.length > 0 ? ` ${reused.length} bài học đã xuất hiện ở video khác — vẫn có thể dùng lại.` : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button onClick={() => void create()} disabled={pending || selected.length === 0}>
            Tạo video
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
