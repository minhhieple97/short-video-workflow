import type { BodySceneType } from "@/features/videos/domain/scene-types";
import type { AiShot } from "@/features/videos/domain/shot-plan";

const CARD_LINE_CHARS = 40;

// The narration's words from the middle on, as a model would quote where its second shot starts.
function middleCue(narration: string): string | null {
  const words = narration.split(/\s+/).filter(Boolean);
  if (words.length < 12) return null;
  const middle = Math.floor(words.length / 2);
  return words.slice(middle, middle + 3).join(" ");
}

// The words of a line, kept whole, up to a card line's length.
function cardLine(text: string): string {
  let line = "";
  for (const word of text.replace(/[.!?…:]+$/u, "").split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > CARD_LINE_CHARS) break;
    line = next;
  }
  return line || text.slice(0, CARD_LINE_CHARS);
}

// Deterministic shots for the offline providers, one kind of each per part of the story, so tests and the E2E run cover
// cues, moods, a supporting character, props, a tag and every card the renderer draws in a story.
export function mockShots(type: BodySceneType, narration: string): AiShot[] {
  const cue = middleCue(narration);
  const second = (shot: Omit<AiShot, "from">): AiShot[] => (cue ? [{ from: cue, ...shot }] : []);
  switch (type) {
    case "SITUATION":
      return [{ mood: "CALM", props: [{ id: "MOBILE_PHONE" }] }, ...second({ size: "CLOSE", mood: "WORRIED" })];
    case "COMMON_MISTAKE":
      return [
        { mood: "WORRIED", props: [{ id: "HOURGLASS" }] },
        ...second({ card: { style: "VERSUS", lines: ["Làm theo thói quen cũ", "Làm theo bài học"] } }),
      ];
    case "KEY_TAKEAWAY":
      return [
        { card: { style: "PUNCH", lines: [cardLine(narration)] } },
        ...second({ action: "IDEA", mood: "SURPRISED" }),
      ];
    case "BETTER_APPROACH":
      return [
        { action: "TALKING", partner: "LISTENING" },
        ...second({ action: "CELEBRATING", mood: "JOYFUL", tag: "Một tuần sau" }),
      ];
    case "ACTION_STEP":
      return [{ card: { style: "LIST", lines: ["Chọn một việc nhỏ", "Làm ngay hôm nay"] } }];
    case "SUMMARY":
      return [{ mood: "HAPPY" }];
  }
}
