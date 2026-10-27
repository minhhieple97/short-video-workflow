"use client";

import { Mic, Trash2, Upload } from "lucide-react";
import { useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, sendJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { LEADING_SILENCE_WARNING_MS } from "../../domain/audio";
import { SCENE_TYPE_LABELS } from "../../domain/scene-types";
import type { SceneDto } from "../../schemas/video.dto";
import { SCENE_TONE } from "../scene-tone";
import { useVideoAction } from "../use-video-action";

export function SceneVoiceRow({ scene, ttsEnabled }: Readonly<{ scene: SceneDto; ttsEnabled: boolean }>) {
  const { pending, run, runJob } = useVideoAction();
  const fileInput = useRef<HTMLInputElement>(null);

  function upload(file: File): void {
    const body = new FormData();
    body.append("file", file);
    void run(
      () => apiRequest(`/api/scenes/${scene.id}/audio`, { method: "POST", body }),
      "Đã tải âm thanh lên cho cảnh.",
    );
  }

  return (
    <li className="bg-card border-border shadow-card relative flex flex-col gap-2 overflow-hidden rounded-2xl border p-4 pl-5">
      <span className={cn("absolute inset-y-0 left-0 w-1.5", SCENE_TONE[scene.type].rail)} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground w-6 text-sm tabular-nums">{scene.order + 1}</span>
        <Badge variant={SCENE_TONE[scene.type].badge}>{SCENE_TYPE_LABELS[scene.type]}</Badge>
        {scene.audio ? (
          <>
            <Badge variant="slate">{scene.audio.provider === "edge-tts" ? "edge-tts" : "Tải lên"}</Badge>
            <Badge variant="mint">{(scene.audio.durationMs / 1000).toFixed(1)}s</Badge>
            {scene.audio.leadingSilenceMs > LEADING_SILENCE_WARNING_MS ? (
              <Badge variant="rose">Im lặng đầu {scene.audio.leadingSilenceMs} ms</Badge>
            ) : null}
          </>
        ) : (
          <Badge variant="amber">Chưa có giọng đọc</Badge>
        )}
      </div>
      <p className="text-sm">{scene.narration}</p>
      {scene.audio ? <audio controls preload="none" src={scene.audio.url} className="h-9 w-full max-w-md" /> : null}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={scene.audio ? "ghost" : "outline"}
          disabled={!ttsEnabled || pending}
          title={ttsEnabled ? undefined : "TTS_MODE=upload"}
          onClick={() =>
            void runJob(() => sendJson<{ jobId: string }>(`/api/scenes/${scene.id}/tts`, "POST"), "Đã tạo giọng đọc.")
          }
        >
          <Mic aria-hidden />
          {scene.audio ? "Tạo lại" : "Tạo giọng đọc"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden />
          {scene.audio ? "Thay bằng tệp" : "Tải lên MP3/WAV"}
        </Button>
        {scene.audio ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => void run(() => sendJson(`/api/scenes/${scene.id}/audio`, "DELETE"), "Đã gỡ giọng đọc.")}
          >
            <Trash2 aria-hidden />
            Gỡ
          </Button>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept=".mp3,.wav,audio/mpeg,audio/wav"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.target.value = "";
          }}
        />
      </div>
    </li>
  );
}
