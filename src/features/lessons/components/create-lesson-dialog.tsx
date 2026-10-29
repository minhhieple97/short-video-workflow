"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { LessonText } from "../domain/lesson-fields";
import type { ChapterRef, LessonDetail } from "../schemas/lesson.dto";
import { EMPTY_LESSON_TEXT, LessonTextFields, lessonTextComplete } from "./lesson-text-fields";

export function CreateLessonDialog({
  bookId,
  chapters,
}: Readonly<{ bookId: string; chapters: readonly ChapterRef[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<LessonText>(EMPTY_LESSON_TEXT);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [excerpt, setExcerpt] = useState("");
  const [pending, setPending] = useState(false);

  async function create(): Promise<void> {
    setPending(true);
    try {
      const lesson = await sendJson<LessonDetail>(`/api/books/${bookId}/lessons`, "POST", {
        ...text,
        chapterIds,
        sourceExcerpt: excerpt,
      });
      toast.success("Đã tạo bài học thủ công (bản nháp).");
      setOpen(false);
      router.push(`/books/${bookId}/lessons/${lesson.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton
          label="Tạo bài học thủ công"
          note={chapters.length === 0 ? "Sách chưa có chương nào" : undefined}
          variant="outline"
          disabled={chapters.length === 0}
        >
          <Plus aria-hidden />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo bài học thủ công</DialogTitle>
          <DialogDescription>
            Bài học được ghi nhận là “Tạo thủ công” và cần liên kết ít nhất một chương nguồn.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Chương nguồn</legend>
          {chapters.map((chapter) => (
            <label key={chapter.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={chapterIds.includes(chapter.id)}
                onCheckedChange={(checked) =>
                  setChapterIds((current) =>
                    checked === true ? [...current, chapter.id] : current.filter((id) => id !== chapter.id),
                  )
                }
              />
              <span title={chapter.title} className="line-clamp-2 min-w-0 wrap-break-word">
                {chapter.order}. {chapter.title}
              </span>
            </label>
          ))}
        </fieldset>
        <LessonTextFields
          idPrefix="new-lesson"
          value={text}
          onChange={(field, value) => setText((current) => ({ ...current, [field]: value }))}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-lesson-excerpt">Trích đoạn bằng chứng (tuỳ chọn)</Label>
          <Textarea
            id="new-lesson-excerpt"
            value={excerpt}
            maxLength={1000}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={() => void create()}
            disabled={pending || chapterIds.length === 0 || !lessonTextComplete(text)}
          >
            Tạo bài học
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
