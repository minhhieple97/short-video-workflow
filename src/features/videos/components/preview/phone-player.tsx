"use client";

import { Player, type ErrorFallback, type PlayerRef } from "@remotion/player";
import { Play } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ShortVideo } from "@/remotion/compositions/short-video";
import { CANVAS } from "@/remotion/theme/tokens";

import { totalFrames, type ShortVideoProps } from "../../domain/composition-props";
import { HOOK_MAX_FRAMES, HOOK_MAX_SECONDS, VIDEO_FPS } from "../../domain/duration";
import {
  PLATFORM_LABELS,
  PLATFORM_PREVIEW_MODES,
  PREVIEW_FRAME,
  type PlatformPreviewMode,
} from "../../domain/safe-zones";
import { SafeZoneOverlay } from "./safe-zone-overlay";

// Up to the nominal preview size, shrinking with the viewport (main + frame padding and the bezel take 4.75rem).
const PHONE_SCREEN = { width: `min(${PREVIEW_FRAME.width}px, calc(100vw - 4.75rem))`, aspectRatio: "9 / 16" } as const;
const PLAYER_STYLE = { width: "100%" } as const;

const PlayerError: ErrorFallback = () => (
  <div className="flex h-full items-center justify-center bg-black p-6 text-center text-sm text-white">
    Không phát được bản xem trước. Hãy tải lại trang.
  </div>
);

// The frame readout lives apart from the Player so that only this text re-renders on every frame.
function PlayerClock({
  playerRef,
  hookFrames,
}: Readonly<{ playerRef: RefObject<PlayerRef | null>; hookFrames: number }>) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setFrame(detail.frame);
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [playerRef]);

  const inHook = frame < hookFrames;
  return (
    <span
      className={cn(
        "tabular-nums",
        inHook ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      {(frame / VIDEO_FPS).toFixed(1)}s{inHook ? " · HOOK" : ""}
    </span>
  );
}

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
  const hookFrames = Math.min(props.scenes[0]?.durationInFrames ?? HOOK_MAX_FRAMES, HOOK_MAX_FRAMES);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      if (stopAtRef.current !== null && detail.frame >= stopAtRef.current) {
        stopAtRef.current = null;
        player.pause();
      }
    };
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, []);

  // Passing the click lets the browser count playback as started by the user, so the narration is not blocked.
  function playHook(event: MouseEvent<HTMLButtonElement>): void {
    stopAtRef.current = hookFrames - 1;
    playerRef.current?.seekTo(0);
    playerRef.current?.play(event);
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
            compositionWidth={CANVAS.width}
            compositionHeight={CANVAS.height}
            fps={CANVAS.fps}
            style={PLAYER_STYLE}
            errorFallback={PlayerError}
            // Mounts the next scene (and loads its narration) a second early so it does not start late.
            defaultPremountInSeconds={1}
            controls
          />
          {showGuide ? <SafeZoneOverlay mode={mode} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
        <Button size="sm" variant="outline" onClickCapture={playHook}>
          <Play aria-hidden />
          Xem {HOOK_MAX_SECONDS} giây đầu
        </Button>
        <label className="flex items-center gap-2">
          <Checkbox checked={showGuide} onCheckedChange={(checked) => setShowGuide(checked === true)} />
          Vùng an toàn
        </label>
        <PlayerClock playerRef={playerRef} hookFrames={hookFrames} />
      </div>
    </div>
  );
}
