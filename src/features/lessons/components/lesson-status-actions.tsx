"use client";

import { Archive, Check, RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { LessonStatus } from "../domain/lesson-fields";

type Action = "approve" | "archive" | "restore";

const MESSAGES: Record<Action, string> = {
  approve: "Đã duyệt bài học.",
  archive: "Đã lưu trữ bài học.",
  restore: "Đã chuyển bài học về bản nháp.",
};

const ACTIONS: Record<LessonStatus, { action: Action; label: string; icon: ReactNode; primary?: boolean }[]> = {
  DRAFT: [
    { action: "approve", label: "Duyệt", icon: <Check aria-hidden />, primary: true },
    { action: "archive", label: "Từ chối (lưu trữ)", icon: <Archive aria-hidden /> },
  ],
  APPROVED: [
    { action: "restore", label: "Trả về nháp", icon: <Undo2 aria-hidden /> },
    { action: "archive", label: "Lưu trữ", icon: <Archive aria-hidden /> },
  ],
  ARCHIVED: [{ action: "restore", label: "Khôi phục về nháp", icon: <RotateCcw aria-hidden />, primary: true }],
};

export function LessonStatusActions({ lessonId, status }: Readonly<{ lessonId: string; status: LessonStatus }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function perform(action: Action): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/lessons/${lessonId}/${action}`, "POST");
      toast.success(MESSAGES[action]);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS[status].map(({ action, label, icon, primary }) => (
        <Button
          key={action}
          variant={primary ? "default" : "outline"}
          disabled={pending}
          onClick={() => void perform(action)}
        >
          {icon}
          {label}
        </Button>
      ))}
    </div>
  );
}
