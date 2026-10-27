"use client";

import { CheckCircle2, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { VideoDetail } from "../schemas/video.dto";
import { useVideoAction } from "./use-video-action";

interface GenerateScriptButtonProps {
  video: Pick<VideoDetail, "id" | "scenes">;
  // A script job for this video is still queued, running or waiting for Claude Code (known from the server).
  busy: boolean;
}

export function GenerateScriptButton({ video, busy }: Readonly<GenerateScriptButtonProps>) {
  const { pending, runJob } = useVideoAction();
  const working = pending || busy;
  const hasScript = video.scenes.length > 0;
  const generate = () =>
    void runJob(
      () => sendJson<{ jobId: string }>(`/api/videos/${video.id}/generate-script`, "POST"),
      "Đã tạo kịch bản. Hãy chọn hook và kiểm tra từng cảnh.",
    );

  const button = (
    <Button variant={hasScript ? "outline" : "default"} disabled={working} onClick={hasScript ? undefined : generate}>
      {working ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
      {working ? "Đang tạo kịch bản…" : hasScript ? "Tạo lại kịch bản" : "Tạo kịch bản"}
    </Button>
  );
  if (!hasScript) return button;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Tạo lại toàn bộ kịch bản?</AlertDialogTitle>
          <AlertDialogDescription>
            Mọi cảnh hiện tại (kể cả phần đã sửa tay) sẽ được thay bằng kịch bản mới. Muốn đổi một cảnh, hãy dùng “Viết
            lại cảnh này”.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction onClick={generate}>Tạo lại</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ApproveScriptButton({
  video,
}: Readonly<{ video: Pick<VideoDetail, "id" | "status" | "scenes" | "hookIssues"> }>) {
  const { pending, run } = useVideoAction();
  const blocked = video.scenes.length === 0 || video.hookIssues.length > 0;
  if (video.status === "APPROVED") return null;

  return (
    <Button
      disabled={pending || blocked}
      title={blocked ? "Cần HOOK hợp lệ trong 3 giây đầu" : undefined}
      onClick={() => void run(() => sendJson(`/api/videos/${video.id}/approve-script`, "POST"), "Đã duyệt kịch bản.")}
    >
      <CheckCircle2 aria-hidden />
      Duyệt kịch bản
    </Button>
  );
}

export function DeleteVideoButton({ videoId, bookId }: Readonly<{ videoId: string; bookId: string }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove(): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/videos/${videoId}`, "DELETE");
      toast.success("Đã xoá video.");
      router.push(`/books/${bookId}?tab=videos`);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive" disabled={pending}>
          <Trash2 aria-hidden />
          Xoá video
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá video này?</AlertDialogTitle>
          <AlertDialogDescription>
            Kịch bản và liên kết bài học của video sẽ bị xoá. Bài học gốc không bị ảnh hưởng; các tệp MP4/âm thanh đã
            tạo vẫn được giữ trên ổ đĩa.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void remove()}>
            Xoá video
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
