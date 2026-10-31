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
import { ProduceLessonsDialog } from "@/features/productions/components/produce-lessons-dialog";
import {
  PRODUCTION_BLOCK_REASONS,
  productionBlock,
  summarizeProductionBlocks,
} from "@/features/productions/domain/producible-lesson";
import type {
  ActiveProductionsByLesson,
  ProductionSettingsDto,
} from "@/features/productions/schemas/production-settings.dto";
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

interface LessonBulkBarProps {
  bookId: string;
  selected: readonly LessonSummary[];
  production: ProductionSettingsDto;
  activeProductions: ActiveProductionsByLesson;
  onDone: () => void;
}

// Approve, reject (archive) or send back to draft every ticked lesson in one request, or make videos of them with no
// further step by hand. Making videos approves the lessons it is made from, so a draft needs no "Duyệt" first.
export function LessonBulkBar({
  bookId,
  selected,
  production,
  activeProductions,
  onDone,
}: Readonly<LessonBulkBarProps>) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const busy = submitting || refreshing;

  const approvable = movable(selected, "APPROVED");
  const rejectable = movable(selected, "ARCHIVED");
  const restorable = movable(selected, "DRAFT");

  const checked = selected.map((lesson) => ({
    lesson,
    block: productionBlock({
      status: lesson.status,
      hasSourceExcerpt: lesson.hasSourceExcerpt,
      inProduction: Object.hasOwn(activeProductions, lesson.id),
    }),
  }));
  const producible = checked.filter(({ block }) => block === null).map(({ lesson }) => lesson);
  const notProducible = checked.flatMap(({ lesson, block }) =>
    block ? [{ id: lesson.id, title: lesson.title, reason: PRODUCTION_BLOCK_REASONS[block] }] : [],
  );
  const skippedSummary = summarizeProductionBlocks(checked.flatMap(({ block }) => (block ? [block] : [])));

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
          ? `Đã chọn ${selected.length} bài học${skippedSummary ? ` · chưa tạo video được: ${skippedSummary}` : ""}`
          : "Chọn bài học để duyệt, từ chối hoặc tạo video cùng lúc."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
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
        <span className="bg-border mx-1 hidden h-6 w-px sm:block" aria-hidden />
        <ProduceLessonsDialog
          bookId={bookId}
          lessons={producible.map(({ id, title, status, usedInVideoCount }) => ({
            id,
            title,
            status,
            usedInVideoCount,
          }))}
          skipped={notProducible}
          settings={production}
        />
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
