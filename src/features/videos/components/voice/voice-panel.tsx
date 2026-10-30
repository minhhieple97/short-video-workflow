"use client";

import { Check, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import { sendJson } from "@/lib/api-client";

import { formatSpeedPercent, paceProfile, type Pace } from "../../domain/pace";
import { summarizeVoice, type SceneVoiceJobs } from "../../domain/voice-queue";
import type { SceneDto } from "../../schemas/video.dto";
import { SceneVoiceRow } from "./scene-voice-row";
import { useVoiceRequest } from "./use-voice-request";

interface VoicePanelProps {
  videoId: string;
  scenes: readonly SceneDto[];
  tts: { mode: "upload" | "edge-tts"; voice: string };
  pace: Pace;
  // Scenes whose voice was made at another speed than the pace asks for.
  staleCount: number;
  // The voice jobs the server knows of, by scene: what is in the queue and what last failed. The queue lives on the
  // server, so it is still shown, and still blocks a second request, after the page is left and opened again.
  jobs: SceneVoiceJobs;
}

export function VoicePanel({ videoId, scenes, tts, pace, staleCount, jobs }: Readonly<VoicePanelProps>) {
  const { busy, request } = useVoiceRequest();
  const visible = scenes.filter((scene) => !scene.hidden);
  const { missing, queued, toRequest } = summarizeVoice(visible, jobs);
  const ttsEnabled = tts.mode !== "upload";
  const profile = paceProfile(pace);

  // Said once when the queue empties while this panel is open, so a person who waited is told how it ended.
  const wasQueued = useRef(false);
  useEffect(() => {
    if (queued > 0) {
      wasQueued.current = true;
      return;
    }
    if (!wasQueued.current) return;
    wasQueued.current = false;
    if (missing === 0) toast.success("Đã tạo xong giọng đọc.");
    else toast.warning(`Hàng đợi đã xong nhưng còn ${missing} cảnh chưa có giọng đọc. Xem lý do ở từng cảnh.`);
  }, [queued, missing]);

  const generate = (scope: "missing" | "all") =>
    request(
      async () => (await sendJson<{ jobs: unknown[] }>(`/api/videos/${videoId}/tts`, "POST", { scope })).jobs.length,
    );

  if (visible.length === 0)
    return <EmptyState title="Chưa có cảnh" description="Tạo kịch bản trước khi tạo giọng đọc." />;

  const waitingOnly = toRequest === 0 && queued > 0;

  return (
    <div className="flex flex-col gap-4">
      <JobsAutoRefresh active={queued > 0} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {ttsEnabled
            ? `${tts.mode} · giọng ${tts.voice} · nhịp ${profile.label} (giọng ${formatSpeedPercent(profile.speedPercent)})`
            : "Chế độ tải lên (TTS_MODE=upload)"}{" "}
          · {missing} cảnh chưa có giọng đọc. Độ dài cảnh lấy theo âm thanh thật.
        </p>
        <Button disabled={!ttsEnabled || toRequest === 0 || busy} onClick={() => void generate("missing")}>
          {busy || waitingOnly ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : toRequest > 0 ? (
            <Wand2 aria-hidden />
          ) : (
            <Check aria-hidden />
          )}
          {busy
            ? "Đang xếp hàng…"
            : toRequest > 0
              ? `Tạo giọng cho ${toRequest} cảnh còn thiếu`
              : waitingOnly
                ? `Đang tạo giọng · còn ${queued} cảnh`
                : "Mọi cảnh đã có giọng đọc"}
        </Button>
      </div>
      {queued > 0 ? (
        <Alert>
          <Loader2 className="animate-spin" aria-hidden />
          <AlertDescription>
            {queued} cảnh đang trong hàng đợi tạo giọng; worker làm lần lượt từng cảnh. Bạn có thể rời trang, việc vẫn
            chạy nền và trang này tự cập nhật khi giọng đọc xong.
          </AlertDescription>
        </Alert>
      ) : null}
      {ttsEnabled && staleCount > 0 ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {staleCount} cảnh có giọng tạo ở nhịp khác nhịp độ hiện tại ({profile.label}). Tạo lại để khớp; cảnh đã
              đúng tốc độ dùng lại giọng cũ, không gọi lại dịch vụ.
            </span>
            <Button variant="outline" disabled={busy || queued > 0} onClick={() => void generate("all")}>
              <RefreshCw aria-hidden />
              Tạo lại giọng cho tất cả cảnh
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <ol className="flex flex-col gap-2">
        {visible.map((scene) => (
          <SceneVoiceRow
            key={`${scene.id}-${scene.audioAssetId ?? "none"}`}
            scene={scene}
            ttsEnabled={ttsEnabled}
            job={jobs[scene.id]}
          />
        ))}
      </ol>
    </div>
  );
}
