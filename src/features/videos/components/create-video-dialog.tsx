"use client";

import { Clapperboard, Loader2 } from "lucide-react";
import Link from "next/link";
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

import { assessLessonLoad, type DurationRange } from "../domain/duration";
import type { Pace } from "../domain/pace";
import { creationProblem, plannedVideoCount, type CreationMode } from "../domain/video-creation";
import type { VideoDetail } from "../schemas/video.dto";
import { CreationModeSelect } from "./creation-mode-select";
import { DurationRangePicker } from "./duration-range-picker";
import { PaceSelect } from "./pace-select";

export interface SelectableLesson {
  id: string;
  title: string;
  usedInVideoCount: number;
}

interface CreatedVideo {
  id: string;
  title: string;
}

interface CreateVideoFormProps {
  bookId: string;
  lessons: readonly SelectableLesson[];
  defaultRange: DurationRange;
  defaultPace: Pace;
  ceilingSec: number;
  onClose: () => void;
}

function CreatedVideos({ videos, onClose }: Readonly<{ videos: readonly CreatedVideo[]; onClose: () => void }>) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Đã tạo {videos.length} video</DialogTitle>
        <DialogDescription>
          Các video chưa có kịch bản: mở từng video để tạo kịch bản. Muốn hệ thống tự làm hết các bước, hãy chọn bài học
          ở tab Bài học rồi bấm “Tạo video”.
        </DialogDescription>
      </DialogHeader>
      <ol className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm">
        {videos.map((video, index) => (
          <li key={video.id} className="flex gap-2">
            <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{index + 1}.</span>
            <Link
              href={`/videos/${video.id}`}
              title={video.title}
              className="line-clamp-2 min-w-0 font-medium wrap-break-word hover:underline"
            >
              {video.title}
            </Link>
          </li>
        ))}
      </ol>
      <DialogFooter>
        <Button onClick={onClose}>Xong</Button>
      </DialogFooter>
    </>
  );
}

function CreateVideoForm({
  bookId,
  lessons,
  defaultRange,
  defaultPace,
  ceilingSec,
  onClose,
}: Readonly<CreateVideoFormProps>) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<CreationMode>("PER_LESSON");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<DurationRange>(defaultRange);
  const [pace, setPace] = useState<Pace>(defaultPace);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<readonly CreatedVideo[] | null>(null);

  // One lesson, or several joined into one video: the video has a title and a description of its own.
  const single = selected.length <= 1 || mode === "MERGED";
  const videoCount = plannedVideoCount(selected.length, mode);
  const problem = creationProblem(selected.length, mode);
  const merged = selected.length > 1 && mode === "MERGED";
  const load = assessLessonLoad(selected.length, duration.maxDurationSec);
  const reused = lessons.filter((lesson) => selected.includes(lesson.id) && lesson.usedInVideoCount > 0);
  const firstSelected = lessons.find((lesson) => lesson.id === selected[0]);
  const note = [
    merged ? load.message : "",
    reused.length > 0 ? `${reused.length} bài học đã xuất hiện ở video khác — vẫn có thể dùng lại.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  function toggle(id: string, checked: boolean): void {
    setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  async function create(): Promise<void> {
    setPending(true);
    try {
      if (single) {
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
        onClose();
        router.push(`/videos/${video.id}`);
        return;
      }
      const { videos } = await sendJson<{ videos: CreatedVideo[] }>("/api/videos/bulk", "POST", {
        bookId,
        // Videos follow the order of the list, whatever order the boxes were ticked in.
        lessonIds: lessons.filter((lesson) => selected.includes(lesson.id)).map((lesson) => lesson.id),
        ...duration,
        pace,
      });
      toast.success(`Đã tạo ${videos.length} video.`);
      setCreated(videos);
      router.refresh();
      setPending(false);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  if (created) return <CreatedVideos videos={created} onClose={onClose} />;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tạo video ngắn 9:16</DialogTitle>
        <DialogDescription>
          Mỗi bài học nên thành một video riêng. Video mới chưa có kịch bản; muốn hệ thống tự làm hết các bước (kịch
          bản, giọng đọc, render), hãy chọn bài học ở tab Bài học rồi bấm “Tạo video”.
        </DialogDescription>
      </DialogHeader>

      <section aria-labelledby="approved-lessons-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="approved-lessons-heading" className="text-sm font-medium">
            Bài học đã duyệt{" "}
            <span className="text-muted-foreground font-normal">
              · đã chọn {selected.length}/{lessons.length}
            </span>
          </h3>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selected.length === lessons.length}
              onClick={() => setSelected(lessons.map((lesson) => lesson.id))}
            >
              Chọn tất cả
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selected.length === 0}
              onClick={() => setSelected([])}
            >
              Bỏ chọn
            </Button>
          </div>
        </div>
        <ul className="border-border flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={selected.includes(lesson.id)}
                  onCheckedChange={(checked) => toggle(lesson.id, checked === true)}
                />
                <span className="min-w-0 wrap-break-word">
                  {lesson.title}
                  {lesson.usedInVideoCount > 0 ? (
                    <span className="text-muted-foreground"> · đã dùng trong {lesson.usedInVideoCount} video</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {selected.length > 1 ? (
        <CreationModeSelect id="new-video-mode" value={mode} onChange={setMode} lessonCount={selected.length} />
      ) : null}

      {single ? (
        <>
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
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Mỗi video lấy tên bài học của nó làm tiêu đề; bạn đổi tên sau trong cài đặt của từng video.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Khoảng thời lượng (dọc 9:16 · 1080×1920 · 30 FPS)</span>
        <DurationRangePicker id="new-video-duration" value={duration} onChange={setDuration} ceilingSec={ceilingSec} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Nhịp độ đọc</span>
        <PaceSelect id="new-video-pace" value={pace} onChange={setPace} />
      </div>

      {problem || note ? (
        <Alert variant={problem || (merged && load.level === "overload") ? "destructive" : "default"}>
          <AlertDescription>{problem ?? note}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button onClick={() => void create()} disabled={pending || selected.length === 0 || problem !== null}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {videoCount > 1 ? `Tạo ${videoCount} video` : "Tạo video"}
        </Button>
      </DialogFooter>
    </>
  );
}

// Makes videos by hand from approved lessons: one video for each lesson, or one video that joins them. Each video starts
// without a script. The form is mounted only while the dialog is open, so every opening starts from a clean selection.
export function CreateVideoDialog({
  bookId,
  lessons,
  defaultRange,
  defaultPace,
  ceilingSec,
}: Readonly<Omit<CreateVideoFormProps, "onClose">>) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={lessons.length === 0}>
          <Clapperboard aria-hidden />
          Tạo video
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <CreateVideoForm
          bookId={bookId}
          lessons={lessons}
          defaultRange={defaultRange}
          defaultPace={defaultPace}
          ceilingSec={ceilingSec}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
