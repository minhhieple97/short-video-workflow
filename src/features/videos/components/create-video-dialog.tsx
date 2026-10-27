"use client";

import { Clapperboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { cn } from "@/lib/utils";

import { assessLessonLoad, EXTENDED_PRESET_SEC, STANDARD_PRESETS_SEC } from "../domain/duration";
import type { VideoDetail } from "../schemas/video.dto";

export interface SelectableLesson {
  id: string;
  title: string;
  usedInVideoCount: number;
}

export function CreateVideoDialog({
  bookId,
  lessons,
}: Readonly<{ bookId: string; lessons: readonly SelectableLesson[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState<number>(60);
  const [extended, setExtended] = useState(false);
  const [pending, setPending] = useState(false);

  const target = extended ? EXTENDED_PRESET_SEC : preset;
  const load = assessLessonLoad(selected.length, target);
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
        targetDurationSec: target,
        extended,
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
        <Button
          disabled={lessons.length === 0}
          title={lessons.length === 0 ? "Cần ít nhất một bài học đã duyệt" : undefined}
        >
          <Clapperboard aria-hidden />
          Tạo video
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo video ngắn 9:16</DialogTitle>
          <DialogDescription>
            Khuyên dùng một bài học cho mỗi video; tối đa hai bài học bổ trợ nhau cho preset 30–60 giây.
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
          <span className="text-sm font-medium">Thời lượng (dọc 9:16 · 1080×1920 · 30 FPS)</span>
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
