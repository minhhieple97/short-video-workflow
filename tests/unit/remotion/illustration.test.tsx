import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { toCompositionProps } from "@/features/videos/domain/composition-props";
import {
  CHARACTER_ACTIONS,
  DEFAULT_ILLUSTRATION,
  ILLUSTRATION_SETTINGS,
  illustrationSchema,
} from "@/features/videos/domain/illustration";
import { SCENE_TYPES } from "@/features/videos/domain/scene-types";
import { cycle } from "@/remotion/illustration/anim";
import { Backdrop } from "@/remotion/illustration/backdrops";
import { Character } from "@/remotion/illustration/character";
import { lookFor } from "@/remotion/illustration/look";

const svg = (children: React.ReactNode) => renderToStaticMarkup(<svg>{children}</svg>);

describe("illustration domain", () => {
  it("gives every scene type a picture and accepts only the known settings and actions", () => {
    for (const type of SCENE_TYPES) expect(illustrationSchema.safeParse(DEFAULT_ILLUSTRATION[type]).success).toBe(true);
    expect(illustrationSchema.safeParse({ setting: "BEACH", action: "THINKING" }).success).toBe(false);
    expect(illustrationSchema.safeParse({ setting: "HOME", action: "DANCING" }).success).toBe(false);
  });

  it("uses a scene's own illustration and falls back to its type's picture", () => {
    const scene = {
      id: "s1",
      type: "SITUATION" as const,
      visualVariant: "SCENARIO_CARD" as const,
      narration: "Một tình huống.",
      onScreenText: "Tình huống",
      durationFrames: 90,
      hidden: false,
      audioAssetId: null,
    };
    const props = toCompositionProps({
      title: "Video",
      book: { title: "Sách" },
      scenes: [scene, { ...scene, id: "s2", illustration: { setting: "CAFE", action: "TALKING" } }],
    });
    expect(props.scenes.map((item) => item.illustration)).toEqual([
      DEFAULT_ILLUSTRATION.SITUATION,
      { setting: "CAFE", action: "TALKING" },
    ]);
  });
});

describe("illustration drawing", () => {
  const look = lookFor("Một video");

  it("draws every setting and every action, the same way for the same frame", () => {
    for (const setting of ILLUSTRATION_SETTINGS) {
      const markup = svg(<Backdrop setting={setting} frame={42} id="t" moving />);
      expect(markup.length).toBeGreaterThan(500);
      expect(svg(<Backdrop setting={setting} frame={42} id="t" moving />)).toBe(markup);
    }
    for (const action of CHARACTER_ACTIONS) {
      const markup = svg(<Character action={action} frame={17} look={look} />);
      expect(markup).toContain("<circle");
      expect(svg(<Character action={action} frame={17} look={look} />)).toBe(markup);
    }
  });

  it("swings the legs when walking, a quarter cycle in", () => {
    const quarter = svg(<Character action="WALKING" frame={6} look={look} />);
    expect(quarter).toContain("rotate(20)");
    expect(quarter).toContain("rotate(-20)");
  });

  it("moves with the frame", () => {
    expect(svg(<Character action="WALKING" frame={0} look={look} />)).not.toBe(
      svg(<Character action="WALKING" frame={6} look={look} />),
    );
    expect(svg(<Backdrop setting="PARK" frame={0} id="t" moving={false} />)).not.toBe(
      svg(<Backdrop setting="PARK" frame={30} id="t" moving={false} />),
    );
  });

  it("stays cheap to render: no blur, filters or images fetched from anywhere", () => {
    const everything = [
      ...ILLUSTRATION_SETTINGS.map((setting) => svg(<Backdrop setting={setting} frame={10} id="t" moving />)),
      ...CHARACTER_ACTIONS.map((action) => svg(<Character action={action} frame={10} look={look} />)),
    ].join("");
    expect(everything).not.toMatch(/filter|blur|<image|href="http/i);
  });

  it("keeps one character per video: the same title always gives the same look", () => {
    expect(lookFor("Thói quen nhỏ")).toEqual(lookFor("Thói quen nhỏ"));
    const looks = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((title) => JSON.stringify(lookFor(title))));
    expect(looks.size).toBeGreaterThan(1);
  });

  it("loops a cycle for any frame, including before the scene starts", () => {
    expect(cycle(45, 30)).toBeCloseTo(0.5);
    expect(cycle(-15, 30)).toBeCloseTo(0.5);
  });
});
