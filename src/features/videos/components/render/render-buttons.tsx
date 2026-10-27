"use client";

import { Clapperboard, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { RenderQuality } from "../../domain/preflight";

interface RenderButtonsProps {
  videoId: string;
  blocked: Record<RenderQuality, boolean>;
  dims: Record<RenderQuality, string>;
}

export function RenderButtons({ videoId, blocked, dims }: Readonly<RenderButtonsProps>) {
  const router = useRouter();
  const [running, setRunning] = useState<RenderQuality | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function render(quality: RenderQuality): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(quality);
    setProgress(0);
    try {
      const { jobId } = await sendJson<{ jobId: string }>(`/api/videos/${videoId}/render`, "POST", { quality });
      toast.info("Đã đưa vào hàng đợi render. Render chạy lần lượt, có thể mất vài phút trên máy yếu.");
      router.refresh();
      const job = await waitForJob(jobId, {
        signal: controller.signal,
        maxAttempts: 600,
        onUpdate: (update) => setProgress(update.progress),
      });
      if (controller.signal.aborted) return;
      if (job?.status === "COMPLETED") toast.success("Render xong. Có thể xem và tải MP4 bên dưới.");
      else toast.error(job?.errorMessage ?? "Render vẫn đang chạy nền. Tải lại trang sau.");
      router.refresh();
    } catch (error) {
      if (!controller.signal.aborted) toast.error(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setRunning(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["DRAFT", "FINAL"] as const).map((quality) => (
        <Button
          key={quality}
          variant={quality === "FINAL" ? "default" : "outline"}
          disabled={running !== null || blocked[quality]}
          onClick={() => void render(quality)}
        >
          {running === quality ? <Loader2 className="animate-spin" aria-hidden /> : <Clapperboard aria-hidden />}
          {quality === "FINAL" ? "Render bản cuối" : "Render nháp"} ({dims[quality]})
        </Button>
      ))}
      {running ? <span className="text-muted-foreground text-sm tabular-nums">Đang render… {progress}%</span> : null}
    </div>
  );
}
