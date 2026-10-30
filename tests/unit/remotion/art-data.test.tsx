import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHARACTER_ACTIONS } from "@/features/videos/domain/illustration";
import { PROP_IDS } from "@/features/videos/domain/props";
import { PeepFigure, peepBounds } from "@/remotion/peeps/peep";
import { PEEP_ART } from "@/remotion/peeps/peeps-art.generated";
import { Prop } from "@/remotion/props/prop";
import { PROP_ART } from "@/remotion/props/prop-art.generated";
import { ACTION_POSES, mainLook } from "@/remotion/stage/cast";

const FORBIDDEN_MARKUP = /<filter|filter=|blur\(|<image|<img|href="http|NaN|Infinity/i;

describe("character art", () => {
  it("has a drawn pose and both faces for every action a script can pick", () => {
    for (const action of CHARACTER_ACTIONS) {
      const pose = ACTION_POSES[action];
      expect(PEEP_ART.bodies[pose.body].paths.length).toBeGreaterThan(0);
      expect(PEEP_ART.faces[pose.face].length).toBeGreaterThan(0);
      expect(PEEP_ART.faces[pose.closeFace].length).toBeGreaterThan(0);
      expect(PEEP_ART.bodies[pose.body].kind === "bust").toBe(!pose.full);
    }
  });

  it("gives every video one look from its title, the same each time", () => {
    expect(mainLook("Video A")).toEqual(mainLook("Video A"));
    const looks = new Set(["A", "B", "C", "D", "E", "F", "G", "H"].map((title) => mainLook(title).hair));
    expect(looks.size).toBeGreaterThan(2);
  });

  it("draws the same clean markup for the same figure, inside its bounds", () => {
    const figure = <PeepFigure body="Device" face="Concerned" look={mainLook("x")} />;
    const markup = renderToStaticMarkup(<svg>{figure}</svg>);
    expect(markup).toBe(renderToStaticMarkup(<svg>{figure}</svg>));
    expect(markup).not.toMatch(FORBIDDEN_MARKUP);
    const box = peepBounds("Device");
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(box.width);
  });
});

describe("prop art", () => {
  it("covers every prop id with a few flat shapes", () => {
    expect(Object.keys(PROP_ART).sort()).toEqual([...PROP_IDS].sort());
    for (const id of PROP_IDS) {
      const shapes = PROP_ART[id];
      expect(shapes.length).toBeGreaterThan(0);
      expect(shapes.length).toBeLessThanOrEqual(40);
      for (const shape of shapes) {
        const fill = shape[0] === "p" ? shape[2] : shape[0] === "e" ? shape[5] : shape.at(-1);
        expect(fill).toMatch(/^#[0-9A-F]{3,8}$/);
      }
    }
  });

  it("renders every prop without filters, images or remote references", () => {
    for (const id of PROP_IDS) {
      expect(
        renderToStaticMarkup(
          <svg>
            <Prop id={id} x={0} y={0} size={64} />
          </svg>,
        ),
      ).not.toMatch(FORBIDDEN_MARKUP);
    }
  });
});
