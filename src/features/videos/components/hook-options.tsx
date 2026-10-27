"use client";

import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sendJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { HOOK_MAX_SECONDS } from "../domain/duration";
import { HOOK_VARIANT_LABELS, VISUAL_VARIANT_LABELS } from "../domain/scene-types";
import type { HookOptionDto, SceneDto } from "../schemas/video.dto";
import { useVideoAction } from "./use-video-action";

interface HookOptionsProps {
  videoId: string;
  options: readonly HookOptionDto[];
  hookScene: SceneDto | undefined;
}

export function HookOptions({ videoId, options, hookScene }: Readonly<HookOptionsProps>) {
  const { pending, run } = useVideoAction();
  if (options.length === 0) {
    return <p className="text-muted-foreground text-sm">Tạo kịch bản để AI đề xuất 2–3 phương án hook.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {options.map((option, index) => {
        const chosen = hookScene?.narration === option.narration && hookScene.onScreenText === option.onScreenText;
        return (
          <Card key={option.variant} className={cn(chosen && "border-foreground")}>
            <CardHeader>
              <CardTitle className="text-sm">{HOOK_VARIANT_LABELS[option.variant]}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-base font-bold tracking-tight">{option.onScreenText}</p>
              <p className="text-muted-foreground">“{option.narration}”</p>
              <div className="flex flex-wrap gap-1">
                <Badge variant={option.estimatedSeconds > HOOK_MAX_SECONDS ? "destructive" : "outline"}>
                  ~{option.estimatedSeconds}s
                </Badge>
                <Badge variant="outline">{VISUAL_VARIANT_LABELS[option.visualVariant]}</Badge>
              </div>
              <Button
                size="sm"
                variant={chosen ? "default" : "outline"}
                disabled={pending || chosen}
                onClick={() =>
                  void run(
                    () => sendJson(`/api/videos/${videoId}/hook`, "POST", { optionIndex: index }),
                    "Đã chọn hook.",
                  )
                }
              >
                {chosen ? <Check aria-hidden /> : null}
                {chosen ? "Đang dùng" : "Dùng hook này"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
