import { useCurrentFrame } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { COLORS, FONT_FAMILY, SAFE_BOX, CANVAS } from "../theme/tokens";

// Phrase-level subtitles placed above the bottom UI zone, never glued to the frame edge.
export function CaptionTrack({ captions }: Readonly<{ captions: CompositionScene["captions"] }>) {
  const frame = useCurrentFrame();
  const cue = captions.find((candidate) => frame >= candidate.startFrame && frame < candidate.endFrame);
  if (!cue) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_BOX.left,
        right: SAFE_BOX.right,
        bottom: SAFE_BOX.bottom + 24,
        display: "flex",
        justifyContent: "center",
        fontFamily: FONT_FAMILY,
        maxWidth: CANVAS.width - SAFE_BOX.left - SAFE_BOX.right,
      }}
    >
      <span
        style={{
          backgroundColor: COLORS.captionBackground,
          color: COLORS.captionText,
          fontSize: 46,
          fontWeight: 500,
          lineHeight: 1.35,
          padding: "14px 26px",
          borderRadius: 18,
          textAlign: "center",
        }}
      >
        {cue.text}
      </span>
    </div>
  );
}
