"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendJson } from "@/lib/api-client";

import { EXTENDED_PRESET_SEC, STANDARD_PRESETS_SEC } from "../domain/duration";
import type { VideoDetail } from "../schemas/video.dto";
import { useVideoAction } from "./use-video-action";

export function VideoSettingsDialog({ video }: Readonly<{ video: VideoDetail }>) {
  const { pending, run } = useVideoAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [preset, setPreset] = useState(video.extended ? 60 : video.targetDurationSec);
  const [extended, setExtended] = useState(video.extended);

  async function save(): Promise<void> {
    const saved = await run(
      () =>
        sendJson(`/api/videos/${video.id}`, "PATCH", {
          title,
          description,
          targetDurationSec: extended ? EXTENDED_PRESET_SEC : preset,
          extended,
          platformPreviewMode: video.platformPreviewMode,
        }),
      "Đã lưu cài đặt video.",
    );
    if (saved) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
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
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset thời lượng">
          {STANDARD_PRESETS_SEC.map((seconds) => (
            <Button
              key={seconds}
              type="button"
              role="radio"
              aria-checked={!extended && preset === seconds}
              variant={!extended && preset === seconds ? "default" : "outline"}
              onClick={() => {
                setExtended(false);
                setPreset(seconds);
              }}
            >
              {seconds} giây
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={extended} onCheckedChange={(checked) => setExtended(checked === true)} />
          Extended Short — 90 giây
        </label>
        <DialogFooter>
          <Button onClick={() => void save()} disabled={pending || title.trim().length === 0}>
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
