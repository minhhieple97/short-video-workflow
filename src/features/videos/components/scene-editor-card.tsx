"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, RefreshCw, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sendJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { estimateNarrationSeconds, HOOK_MAX_SECONDS } from "../domain/duration";
import { SCENE_TYPE_LABELS, VISUAL_VARIANT_LABELS, VISUAL_VARIANTS, toVisualVariant } from "../domain/scene-types";
import type { SceneDto } from "../schemas/video.dto";
import { useScriptLocked } from "./script-lock-context";
import { useVideoAction } from "./use-video-action";

interface SceneEditorCardProps {
  videoId: string;
  scene: SceneDto;
  sceneIds: readonly string[];
}

export function SceneEditorCard({ videoId, scene, sceneIds }: Readonly<SceneEditorCardProps>) {
  const { pending, run, runJob } = useVideoAction();
  const locked = useScriptLocked();
  const [title, setTitle] = useState(scene.title ?? "");
  const [narration, setNarration] = useState(scene.narration);
  const [onScreenText, setOnScreenText] = useState(scene.onScreenText);
  const [visualVariant, setVisualVariant] = useState(scene.visualVariant);

  const isHook = scene.type === "HOOK";
  const index = sceneIds.indexOf(scene.id);
  const seconds = estimateNarrationSeconds(narration);
  const dirty =
    title !== (scene.title ?? "") ||
    narration !== scene.narration ||
    onScreenText !== scene.onScreenText ||
    visualVariant !== scene.visualVariant;
  const url = `/api/videos/${videoId}/scenes/${scene.id}`;
  const save = (hidden = scene.hidden) =>
    run(() => sendJson(url, "PATCH", { title, narration, onScreenText, visualVariant, hidden }), "Đã lưu cảnh.");

  function move(direction: -1 | 1): void {
    const order = [...sceneIds];
    const [moved] = order.splice(index, 1);
    if (moved) order.splice(index + direction, 0, moved);
    void run(() => sendJson(`/api/videos/${videoId}/scenes`, "PATCH", { sceneIds: order }));
  }

  return (
    <Card className={cn(scene.hidden && "opacity-60")}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <span className="text-muted-foreground w-6 text-sm tabular-nums">{index + 1}</span>
        <Badge variant={isHook ? "default" : "secondary"}>{SCENE_TYPE_LABELS[scene.type]}</Badge>
        <Badge variant={isHook && seconds > HOOK_MAX_SECONDS ? "destructive" : "outline"}>~{seconds}s</Badge>
        {scene.hidden ? <Badge variant="outline">Đang ẩn</Badge> : null}
        <span className="text-muted-foreground ml-auto text-xs">phiên bản {scene.version}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isHook ? null : (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${scene.id}-title`}>Tiêu đề cảnh</Label>
            <Input id={`${scene.id}-title`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${scene.id}-narration`}>Lời dẫn (tiếng Việt)</Label>
          <Textarea
            id={`${scene.id}-narration`}
            value={narration}
            maxLength={600}
            rows={3}
            onChange={(e) => setNarration(e.target.value)}
          />
          {isHook && seconds > HOOK_MAX_SECONDS ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              Hook cần đọc xong trong {HOOK_MAX_SECONDS} giây đầu — hãy rút gọn.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${scene.id}-text`}>Chữ trên màn hình</Label>
          <Input
            id={`${scene.id}-text`}
            value={onScreenText}
            maxLength={120}
            onChange={(e) => setOnScreenText(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${scene.id}-layout`}>Bố cục</Label>
          <Select
            value={visualVariant}
            onValueChange={(value) => setVisualVariant(toVisualVariant(value))}
            disabled={locked}
          >
            <SelectTrigger id={`${scene.id}-layout`} className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISUAL_VARIANTS.map((variant) => (
                <SelectItem key={variant} value={variant}>
                  {VISUAL_VARIANT_LABELS[variant]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || pending || !narration.trim() || !onScreenText.trim()}
          >
            <Save aria-hidden /> Lưu cảnh
          </Button>
          {isHook ? null : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  void runJob(() => sendJson<{ jobId: string }>(`${url}/regenerate`, "POST"), "Đã viết lại cảnh này.")
                }
              >
                <RefreshCw aria-hidden /> Viết lại cảnh này
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => void save(!scene.hidden)}>
                {scene.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />} {scene.hidden ? "Hiện" : "Ẩn"}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Chuyển lên"
                disabled={pending || index <= 1}
                onClick={() => move(-1)}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Chuyển xuống"
                disabled={pending || index === sceneIds.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive ml-auto"
                disabled={pending}
                onClick={() => void run(() => sendJson(url, "DELETE"), "Đã xoá cảnh.")}
              >
                <Trash2 aria-hidden /> Xoá
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
