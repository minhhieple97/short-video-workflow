"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { sendJson } from "@/lib/api-client";

import { isDurationPreset, DEFAULT_TARGET_SEC } from "../domain/duration";
import type { VideoDetail } from "../schemas/video.dto";
import { DurationPresetPicker, type DurationChoice } from "./duration-preset-picker";
import { useVideoAction } from "./use-video-action";

export function VideoSettingsDialog({
  video,
  locked,
  maxDurationSec,
}: Readonly<{ video: VideoDetail; locked: boolean; maxDurationSec: number }>) {
  const { pending, run } = useVideoAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [duration, setDuration] = useState<DurationChoice>({
    targetDurationSec: isDurationPreset(video.targetDurationSec) ? video.targetDurationSec : DEFAULT_TARGET_SEC,
    extended: video.extended,
  });

  async function save(): Promise<void> {
    const saved = await run(
      () =>
        sendJson(`/api/videos/${video.id}`, "PATCH", {
          title,
          description,
          ...duration,
          platformPreviewMode: video.platformPreviewMode,
        }),
      "Đã lưu cài đặt video.",
    );
    if (saved) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={locked}>
          <Settings2 aria-hidden />
          Cài đặt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cài đặt video</DialogTitle>
          <DialogDescription>Định dạng luôn là 9:16, 1080×1920, 30 FPS.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-title">Tiêu đề</Label>
          <Input id="settings-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-description">Mô tả ngắn</Label>
          <Textarea
            id="settings-description"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <DurationPresetPicker value={duration} onChange={setDuration} maxDurationSec={maxDurationSec} />
        <DialogFooter>
          <Button onClick={() => void save()} disabled={pending || title.trim().length === 0}>
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
