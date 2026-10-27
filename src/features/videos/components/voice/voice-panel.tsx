"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { SceneDto } from "../../schemas/video.dto";
import { SceneVoiceRow } from "./scene-voice-row";

interface VoicePanelProps {
  videoId: string;
  scenes: readonly SceneDto[];
  tts: { mode: "upload" | "edge-tts"; voice: string; speed: number };
}

export function VoicePanel({ videoId, scenes, tts }: Readonly<VoicePanelProps>) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const visible = scenes.filter((scene) => !scene.hidden);
  const missing = visible.filter((scene) => !scene.audio).length;
  const ttsEnabled = tts.mode === "edge-tts";

  async function generateMissing(): Promise<void> {
    try {
      const { jobs } = await sendJson<{ jobs: { jobId: string }[] }>(`/api/videos/${videoId}/tts`, "POST");
      let failed = 0;
      for (const [index, job] of jobs.entries()) {
        setProgress(`Đang tạo ${index + 1}/${jobs.length}…`);
        const settled = await waitForJob(job.jobId);
        if (settled?.status !== "COMPLETED") failed += 1;
        router.refresh();
      }
      if (failed > 0) toast.error(`${failed} cảnh tạo giọng thất bại — xem trang Tác vụ, hoặc tải âm thanh lên.`);
      else toast.success(`Đã tạo giọng đọc cho ${jobs.length} cảnh.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setProgress(null);
    }
  }

  if (visible.length === 0)
    return <EmptyState title="Chưa có cảnh" description="Tạo kịch bản trước khi tạo giọng đọc." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {ttsEnabled
            ? `edge-tts · giọng ${tts.voice} · tốc độ ${tts.speed >= 0 ? "+" : ""}${tts.speed}%`
            : "Chế độ tải lên (TTS_MODE=upload)"}{" "}
          · {missing} cảnh chưa có giọng đọc. Độ dài cảnh lấy theo âm thanh thật.
        </p>
        <Button disabled={!ttsEnabled || missing === 0 || progress !== null} onClick={() => void generateMissing()}>
          {progress ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
          {progress ?? "Tạo giọng cho các cảnh còn thiếu"}
        </Button>
      </div>
      <ol className="flex flex-col gap-2">
        {visible.map((scene) => (
          <SceneVoiceRow key={`${scene.id}-${scene.audioAssetId ?? "none"}`} scene={scene} ttsEnabled={ttsEnabled} />
        ))}
      </ol>
    </div>
  );
}
