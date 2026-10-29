// Six ways to tell the same six-part story (hook → situation → mistake → lesson → resolution → action). The frame and its
// order checks do not change; the angle only says how a video is told, so neighbouring videos are not the same story shape.
export const STORY_ANGLES = ["PEAK_FIRST", "DIALOGUE", "TWO_PATHS", "MYTH_BUST", "TWIST", "ESCALATION"] as const;
export type StoryAngle = (typeof STORY_ANGLES)[number];

export const STORY_ANGLE_LABELS: Record<StoryAngle, string> = {
  PEAK_FIRST: "Bắt đầu từ đỉnh điểm",
  DIALOGUE: "Cuộc đối thoại",
  TWO_PATHS: "Hai lối rẽ",
  MYTH_BUST: "Phá một niềm tin",
  TWIST: "Cú đảo chiều",
  ESCALATION: "Leo thang từng bước",
};

// FNV-1a: the same text gives the same number on every run and machine, which Math.random or the clock would not.
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Nothing is stored: the same seed and step always give the same angle, so a retry or a restart tells the story it started,
// while `length` consecutive steps from one seed use every angle once. A script is seeded by its video and `scriptVersion`
// (regenerating it moves to the next angle); a production by its batch and the item's position (neighbours differ).
export function pickStoryAngle(seed: string, step: number): StoryAngle {
  const { length } = STORY_ANGLES;
  const index = (((hashSeed(seed) + step) % length) + length) % length;
  return STORY_ANGLES[index] ?? STORY_ANGLES[0];
}
