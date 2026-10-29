import { describe, expect, it } from "vitest";

import { pickStoryAngle, STORY_ANGLE_LABELS, STORY_ANGLES } from "@/features/videos/domain/story-angle";

describe("story angles", () => {
  it("names every angle in Vietnamese", () => {
    expect(Object.keys(STORY_ANGLE_LABELS).sort()).toEqual([...STORY_ANGLES].sort());
    for (const angle of STORY_ANGLES) expect(STORY_ANGLE_LABELS[angle].trim().length).toBeGreaterThan(0);
  });

  it("gives the same angle for the same seed and step, so a retry tells the story it started", () => {
    expect(pickStoryAngle("batch-1", 3)).toBe(pickStoryAngle("batch-1", 3));
    expect(pickStoryAngle("cmvqpzg240002nuip5jdm2yz3", 1)).toBe(pickStoryAngle("cmvqpzg240002nuip5jdm2yz3", 1));
  });

  it("uses every angle once across as many consecutive steps as there are angles, whatever the seed", () => {
    for (const seed of ["batch-1", "cmvtbci0m0009szipzsqn4t72", "", "Sách hay"]) {
      const used = Array.from({ length: STORY_ANGLES.length }, (_, step) => pickStoryAngle(seed, step + 1));
      expect(new Set(used).size).toBe(STORY_ANGLES.length);
    }
  });

  it("never gives two neighbouring items of a batch the same angle", () => {
    for (let position = 1; position < 40; position += 1) {
      expect(pickStoryAngle("batch-7", position + 1)).not.toBe(pickStoryAngle("batch-7", position));
    }
  });

  it("starts different batches, and different videos, at different angles", () => {
    const starts = Array.from({ length: 50 }, (_, index) => pickStoryAngle(`cuid-${index}`, 1));
    expect(new Set(starts).size).toBeGreaterThanOrEqual(4);
  });

  it("moves to a different angle each time a script is regenerated", () => {
    const first = pickStoryAngle("video-1", 1);
    const second = pickStoryAngle("video-1", 2);
    const third = pickStoryAngle("video-1", 3);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("stays inside the list for any step, even a negative or very large one", () => {
    for (const step of [-7, -1, 0, 1, 5, 6, 1_000_003]) {
      expect(STORY_ANGLES).toContain(pickStoryAngle("video-1", step));
    }
  });
});
