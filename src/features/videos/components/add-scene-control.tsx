"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendJson } from "@/lib/api-client";

import { BODY_SCENE_TYPES, SCENE_TYPE_LABELS } from "../domain/scene-types";
import { useScriptLocked } from "./script-lock-context";
import { useVideoAction } from "./use-video-action";

export function AddSceneControl({ videoId }: Readonly<{ videoId: string }>) {
  const { pending, run } = useVideoAction();
  const locked = useScriptLocked();
  const [type, setType] = useState<string>("SUMMARY");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={type} onValueChange={setType} disabled={locked}>
        <SelectTrigger className="w-56" aria-label="Loại cảnh mới">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BODY_SCENE_TYPES.map((sceneType) => (
            <SelectItem key={sceneType} value={sceneType}>
              {SCENE_TYPE_LABELS[sceneType]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          void run(() => sendJson(`/api/videos/${videoId}/scenes`, "POST", { type }), "Đã thêm cảnh từ mẫu.")
        }
      >
        <Plus aria-hidden />
        Thêm cảnh từ mẫu
      </Button>
    </div>
  );
}
