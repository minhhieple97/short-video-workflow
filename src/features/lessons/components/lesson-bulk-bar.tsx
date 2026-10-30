"use client";

import { Archive, Check, Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";

import { canMoveLesson, type LessonStatus } from "../domain/lesson-fields";
import type { LessonSummary } from "../schemas/lesson.dto";

interface BulkStatusResponse {
  changed: number;
  unchanged: number;
  blocked: number;
}

// Which lessons each button moves is decided by the same rules the server applies, so a button's count is what a click
// changes, and it is off when it would change nothing.
function movable(lessons: readonly LessonSummary[], status: LessonStatus): string[] {
  return lessons.filter((lesson) => canMoveLesson(lesson.status, status)).map((lesson) => lesson.id);
}

function countLabel(label: string, count: number): string {
  return count > 0 ? `${label} ${count} bài` : label;
}

// Approve, reject (archive) or send back to draft every ticked lesson in one request.
export function LessonBulkBar({
  bookId,
  selected,
  onDone,
}: Readonly<{ bookId: string; selected: readonly LessonSummary[]; onDone: () => void }>) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const busy = submitting || refreshing;

  const approvable = movable(selected, "APPROVED");
  const rejectable = movable(selected, "ARCHIVED");
  const restorable = movable(selected, "DRAFT");

  async function apply(ids: readonly string[], status: LessonStatus, done: string): Promise<void> {
    setSubmitting(true);
    try {
      const { changed, blocked } = await sendJson<BulkStatusResponse>(`/api/books/${bookId}/lessons/status`, "POST", {
        lessonIds: ids,
        status,
      });
      const skipped = blocked > 0 ? ` ${blocked} bài không đổi được vì trạng thái đã thay đổi.` : "";
      toast.success(`${done.replace("{n}", String(changed))}${skipped}`);
      onDone();
      startRefresh(() => router.refresh());
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2" role="toolbar" aria-label="Thao tác hàng loạt">
      <p className="text-muted-foreground text-sm" role="status">
        {selected.length > 0
          ? `Đã chọn ${selected.length} bài học`
          : "Chọn bài học để duyệt hoặc từ chối nhiều bài cùng lúc."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || approvable.length === 0}
          aria-busy={busy}
          onClick={() => void apply(approvable, "APPROVED", "Đã duyệt {n} bài học.")}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {countLabel("Duyệt", approvable.length)}
        </Button>
        <Button variant="outline" disabled={busy || rejectable.length === 0} onClick={() => setConfirmingReject(true)}>
          <Archive aria-hidden />
          {countLabel("Từ chối", rejectable.length)}
        </Button>
        <Button
          variant="outline"
          disabled={busy || restorable.length === 0}
          onClick={() => void apply(restorable, "DRAFT", "Đã chuyển {n} bài học về bản nháp.")}
        >
          <Undo2 aria-hidden />
          {countLabel("Trả về nháp", restorable.length)}
        </Button>
      </div>

      <AlertDialog open={confirmingReject} onOpenChange={setConfirmingReject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Từ chối {rejectable.length} bài học?</AlertDialogTitle>
            <AlertDialogDescription>
              Các bài học này được lưu trữ và không còn được đề xuất để làm video. Video đã tạo từ chúng không bị thay
              đổi, và bạn có thể trả chúng về bản nháp bất cứ lúc nào.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingReject(false);
                void apply(rejectable, "ARCHIVED", "Đã từ chối {n} bài học.");
              }}
            >
              Từ chối
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
