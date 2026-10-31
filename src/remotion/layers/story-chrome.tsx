import { useCurrentFrame } from "remotion";

import type { ShortVideoProps } from "@/features/videos/domain/composition-props";
import { shotRenderMode } from "@/features/videos/domain/scene-shots";

import { SETS } from "../stage/sets/sets";
import { ACCENT, FONT_FAMILY, INK, LAYOUT, SAFE_BOX } from "../theme/tokens";

const MAX_SEGMENTS = 8;

interface Run {
  label: string;
  type: string;
  start: number;
  end: number;
}

// Consecutive scenes of the same part make one run: one segment of the progress bar, one label.
function storyRuns(scenes: ShortVideoProps["scenes"]): Run[] {
  const runs: Run[] = [];
  let start = 0;
  for (const scene of scenes) {
    const last = runs.at(-1);
    if (last && last.type === scene.type) last.end = start + scene.durationInFrames;
    else runs.push({ label: scene.label, type: scene.type, start, end: start + scene.durationInFrames });
    start += scene.durationInFrames;
  }
  return runs;
}

// Progress through the story's parts, the current part's name and, from the lesson on, the book it comes from. Drawn over
// the pictures, outside the transitions, so it never slides or wipes.
export function StoryChrome({ scenes, bookTitle }: Pick<ShortVideoProps, "scenes" | "bookTitle">) {
  const frame = useCurrentFrame();
  const runs = storyRuns(scenes);
  const run = runs.find((candidate) => frame < candidate.end) ?? runs.at(-1);
  const ends = scenes.map((_, index) =>
    scenes.slice(0, index + 1).reduce((sum, each) => sum + each.durationInFrames, 0),
  );
  const index = ends.findIndex((end) => end > frame);
  const scene = scenes[index] ?? scenes.at(-1);
  if (!run || !scene) return null;
  // The chrome reads on whatever shot is up: light on a card or a dark set, dark on a light one.
  const sceneFrame = frame - ((ends[index] ?? frame) - scene.durationInFrames);
  const shot = scene.shots.find((candidate) => sceneFrame < candidate.startFrame + candidate.durationInFrames);
  const current = shot ?? scene.shots.at(-1);
  const dark = current ? shotRenderMode(scene.layout, current) === "TEXT" || SETS[current.setting].dark : false;
  const lessonStart = runs.find((candidate) => candidate.type === "KEY_TAKEAWAY")?.start;
  const showBook = lessonStart !== undefined && frame >= lessonStart;
  const segments = runs.length <= MAX_SEGMENTS ? runs : [{ ...run, start: 0, end: runs.at(-1)?.end ?? run.end }];
  const gap = 10;
  const width = (LAYOUT.contentWidth - gap * (segments.length - 1)) / segments.length;
  const track = dark ? "rgba(255,255,255,0.28)" : "rgba(28,25,23,0.16)";
  return (
    <>
      <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        {segments.map((segment, index) => {
          const filled = Math.min(1, Math.max(0, (frame - segment.start) / (segment.end - segment.start)));
          const x = SAFE_BOX.left + index * (width + gap);
          return (
            <g key={segment.start}>
              <rect x={x} y={LAYOUT.progressY} width={width} height={10} rx={5} fill={track} />
              <rect x={x} y={LAYOUT.progressY} width={width * filled} height={10} rx={5} fill={ACCENT} />
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          top: LAYOUT.chipY,
          left: SAFE_BOX.left,
          right: SAFE_BOX.right,
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: FONT_FAMILY,
        }}
      >
        {scene.type === "HOOK" ? null : (
          <div
            style={{
              flexShrink: 0,
              padding: "6px 22px",
              borderRadius: 999,
              background: dark ? "#FFFFFF" : INK,
              color: dark ? INK : "#FFFFFF",
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {run.label}
          </div>
        )}
        {showBook ? (
          <div
            style={{
              minWidth: 0,
              marginLeft: "auto",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              fontSize: 28,
              fontWeight: 500,
              color: dark ? "rgba(255,255,255,0.8)" : "rgba(28,25,23,0.7)",
            }}
          >
            Từ sách: {bookTitle}
          </div>
        ) : null}
      </div>
    </>
  );
}
