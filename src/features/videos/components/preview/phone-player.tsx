"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ShortVideo } from "@/remotion/compositions/short-video";

import { totalFrames, type ShortVideoProps } from "../../domain/composition-props";
import { HOOK_MAX_FRAMES, VIDEO_FPS } from "../../domain/duration";
import {
  PLATFORM_LABELS,
  PLATFORM_PREVIEW_MODES,
  PREVIEW_FRAME,
  type PlatformPreviewMode,
} from "../../domain/safe-zones";
import { SafeZoneOverlay } from "./safe-zone-overlay";

// Up to the nominal preview size, shrinking with the viewport (main + frame padding and the bezel take 4.75rem).
const PHONE_SCREEN = { width: `min(${PREVIEW_FRAME.width}px, calc(100vw - 4.75rem))`, aspectRatio: "9 / 16" } as const;

interface PhonePlayerProps {
  props: ShortVideoProps;
  initialMode: PlatformPreviewMode;
  onModeChange: (mode: PlatformPreviewMode) => void;
}

export function PhonePlayer({ props, initialMode, onModeChange }: Readonly<PhonePlayerProps>) {
  const playerRef = useRef<PlayerRef>(null);
  const stopAtRef = useRef<number | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [showGuide, setShowGuide] = useState(true);
  const [frame, setFrame] = useState(0);
  const hookFrames = Math.min(props.scenes[0]?.durationInFrames ?? HOOK_MAX_FRAMES, HOOK_MAX_FRAMES);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      setFrame(detail.frame);
      if (stopAtRef.current !== null && detail.frame >= stopAtRef.current) {
        stopAtRef.current = null;
        player.pause();
      }
    };
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, []);

  function playHook(): void {
    stopAtRef.current = hookFrames - 1;
    playerRef.current?.seekTo(0);
    playerRef.current?.play();
  }

  return (
    <div className="bg-tone-violet mx-auto flex w-fit max-w-full flex-col items-center gap-5 rounded-3xl p-3 sm:p-6">
      <div
        className="bg-card flex flex-wrap justify-center gap-1 rounded-full p-1"
        role="radiogroup"
        aria-label="Nền tảng xem trước"
      >
        {PLATFORM_PREVIEW_MODES.map((value) => (
          <Button
            key={value}
            size="sm"
            role="radio"
            aria-checked={mode === value}
            variant={mode === value ? "default" : "ghost"}
            className="rounded-full"
            onClick={() => {
              setMode(value);
              onModeChange(value);
            }}
          >
            {PLATFORM_LABELS[value]}
          </Button>
        ))}
      </div>

      <div className="bg-ink rounded-[2.4rem] border-[10px] border-[#0f0c2b] shadow-[0_24px_48px_rgb(27_23_64/0.35)]">
        <div className="relative overflow-hidden rounded-[1.6rem]" style={PHONE_SCREEN}>
          <Player
            ref={playerRef}
            component={ShortVideo}
            inputProps={props}
            durationInFrames={totalFrames(props)}
            compositionWidth={1080}
            compositionHeight={1920}
            fps={VIDEO_FPS}
            style={{ width: "100%" }}
            controls
          />
          {showGuide ? <SafeZoneOverlay mode={mode} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
        <Button size="sm" variant="outline" onClick={playHook}>
          <Play aria-hidden />
          Xem 3 giây đầu
        </Button>
        <label className="flex items-center gap-2">
          <Checkbox checked={showGuide} onCheckedChange={(checked) => setShowGuide(checked === true)} />
          Vùng an toàn
        </label>
        <span
          className={cn(
            "tabular-nums",
            frame < hookFrames ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
          )}
        >
          {(frame / VIDEO_FPS).toFixed(1)}s{frame < hookFrames ? " · HOOK" : ""}
        </span>
      </div>
    </div>
  );
}
