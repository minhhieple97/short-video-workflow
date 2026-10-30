import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Accessories, BustPose, Face, FacialHair, Hair, SittingPose, StandingPose } from "react-peeps";

// Turns the curated Open Peeps pieces (CC0 art, packaged by react-peeps under MIT) into plain path data for
// src/remotion/peeps/peeps-art.generated.ts, so the video code draws them without the package: no random ids, no React
// 16-era runtime, only the pieces the catalogue uses. Run after changing the lists below: pnpm peeps:generate

const OUTPUT = path.join(process.cwd(), "src/remotion/peeps/peeps-art.generated.ts");

type Group = Record<string, ComponentType<{ strokeColor: string; backgroundColor: string }>>;

const SELECTION = {
  bodies: {
    bust: [
      "Shirt",
      "Coffee",
      "Device",
      "Geek",
      "Explaining",
      "Sweater",
      "ShirtFilled",
      "ArmsCrossed",
      "Whatever",
      "Paper",
      "PointingUp",
    ],
    standing: [
      "RestingWB",
      "CrossedArmsWB",
      "PointingFingerWB",
      "RoboDanceWB",
      "WalkingWB",
      "RestingBW",
      "CrossedArmsBW",
      "PointingFingerBW",
      "RoboDanceBW",
      "WalkingBW",
    ],
    sitting: ["MediumWB", "OneLegUpWB", "HandsBackWB", "MediumBW", "OneLegUpBW", "HandsBackBW"],
  },
  faces: [
    "Calm",
    "Smile",
    "SmileBig",
    "SmileLol",
    "Solemn",
    "Concerned",
    "ConcernedFear",
    "Fear",
    "Angry",
    "Awe",
    "Tired",
    "Driven",
    "Blank",
    "Suspicious",
    "Cheeky",
    "EyesClosed",
    "Explaining",
    "Serious",
    "Hectic",
    "OldAged",
  ],
  hair: [
    "ShortMessy",
    "Short",
    "ShortVolumed",
    "Pomp",
    "Medium",
    "MediumShort",
    "MediumStraight",
    "Long",
    "LongBangs",
    "Bun",
    "BangsFilled",
    "GrayMedium",
    "GrayShort",
    "Bald",
  ],
  accessories: ["GlassRound", "GlassRoundThick"],
  facialHair: ["MoustacheThin", "Goatee", "Full"],
} as const;

const BODY_GROUPS: Record<keyof typeof SELECTION.bodies, Group> = {
  bust: BustPose as Group,
  standing: StandingPose as Group,
  sitting: SittingPose as Group,
};

// [d, paint (0 = line colour, 1 = fill colour), dx, dy, evenOdd]
type PathTuple = [string, 0 | 1, number, number, 0 | 1];

const round = (value: number) => Math.round(value * 100) / 100;

// One decimal is under 0.05 px at the sizes the pieces are drawn, and keeps the module (also shipped to the editor's Player)
// a fraction of its size.
function compactPath(d: string): string {
  return d
    .replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (number) => String(Math.round(Number(number) * 10) / 10))
    .replace(/([A-Za-z])\s+/g, "$1")
    .replace(/\s+([A-Za-z])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/ -/g, "-")
    .trim();
}

function attributes(tag: string): Map<string, string> {
  return new Map([...tag.matchAll(/ ([\w-]+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

function translation(transform: string | undefined): [number, number] {
  if (!transform) return [0, 0];
  const match = /^translate\(([-\d.e]+)(?:[ ,]+([-\d.e]+))?\)$/.exec(transform.trim());
  if (!match) throw new Error(`Unsupported transform "${transform}"`);
  return [Number(match[1]), Number(match[2] ?? 0)];
}

function piecePaths(name: string, component: ComponentType<{ strokeColor: string; backgroundColor: string }>) {
  const markup = renderToStaticMarkup(createElement(component, { strokeColor: "S", backgroundColor: "F" }));
  const stack: [number, number][] = [[0, 0]];
  const paths: PathTuple[] = [];
  for (const [tag] of markup.matchAll(/<\/?[a-z]+[^>]*>/g)) {
    if (tag === "</g>") {
      stack.pop();
      continue;
    }
    const element = /^<([a-z]+)/.exec(tag)?.[1];
    const attrs = attributes(tag);
    const [ox, oy] = stack.at(-1) ?? [0, 0];
    const [tx, ty] = translation(attrs.get("transform"));
    if (element === "g") {
      stack.push([ox + tx, oy + ty]);
    } else if (element === "path") {
      const fill = attrs.get("fill");
      // A few pieces carry an invisible leftover shape (no fill, no stroke); drawing it would only cost time.
      if (fill === "none" && attrs.get("stroke") === "none") continue;
      if (fill !== "S" && fill !== "F") throw new Error(`${name}: unexpected fill "${fill}"`);
      const d = attrs.get("d") ?? "";
      if (!/^[MmLlHhVvCcSsQqTtZz\d\s.,e-]+$/.test(d)) throw new Error(`${name}: unexpected path data`);
      paths.push([
        compactPath(d),
        fill === "S" ? 0 : 1,
        round(ox + tx),
        round(oy + ty),
        attrs.get("fill-rule") === "evenodd" ? 1 : 0,
      ]);
    } else if (!tag.startsWith("</")) {
      throw new Error(`${name}: unsupported element <${element}>`);
    }
  }
  return paths;
}

// Bounding box from the absolute coordinates of each path (control points included, so it is a little generous).
function bounds(paths: PathTuple[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [d, , dx, dy] of paths) {
    if (/[a-y]/.test(d.replace(/e-?\d/g, ""))) throw new Error("Relative path commands are not supported by bounds()");
    const numbers = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      minX = Math.min(minX, (numbers[index] ?? 0) + dx);
      maxX = Math.max(maxX, (numbers[index] ?? 0) + dx);
      minY = Math.min(minY, (numbers[index + 1] ?? 0) + dy);
      maxY = Math.max(maxY, (numbers[index + 1] ?? 0) + dy);
    }
  }
  return [Math.floor(minX), Math.floor(minY), Math.ceil(maxX), Math.ceil(maxY)];
}

function pick(group: Group, names: readonly string[]) {
  return Object.fromEntries(
    names.map((name) => {
      const component = group[name];
      if (!component) throw new Error(`Unknown piece "${name}"`);
      return [name, piecePaths(name, component)];
    }),
  );
}

async function main() {
  const bodies = Object.fromEntries(
    Object.entries(SELECTION.bodies).flatMap(([kind, names]) =>
      names.map((name) => {
        const component = BODY_GROUPS[kind as keyof typeof SELECTION.bodies][name];
        if (!component) throw new Error(`Unknown ${kind} pose "${name}"`);
        const paths = piecePaths(name, component);
        return [name, { kind, bounds: bounds(paths), paths }];
      }),
    ),
  );
  const art = {
    bodies,
    faces: pick(Face as Group, SELECTION.faces),
    hair: pick(Hair as Group, SELECTION.hair),
    accessories: pick(Accessories as Group, SELECTION.accessories),
    facialHair: pick(FacialHair as Group, SELECTION.facialHair),
  };
  const source = [
    "// Open Peeps by Pablo Stanley (CC0 1.0, https://www.openpeeps.com), path data taken from react-peeps (MIT) by",
    "// scripts/generate-peeps-art.ts. See THIRD_PARTY_NOTICES.md. Generated file: do not edit by hand.",
    "// A path is [d, paint (0 = line colour, 1 = fill colour), dx, dy, evenOdd]; bounds are [minX, minY, maxX, maxY].",
    "",
    'import type { PeepArt } from "./peep-art-types";',
    "",
    `export const PEEP_ART = ${JSON.stringify(art)} as const satisfies PeepArt;`,
    "",
  ].join("\n");
  if (!/^[\x20-\x7E\n]*$/.test(source)) throw new Error("Generated art must be ASCII");
  await fs.writeFile(OUTPUT, source);
  await promisify(execFile)("pnpm", ["exec", "prettier", "--write", OUTPUT]);
  console.log(`${OUTPUT}: ${Math.round(source.length / 1024)} KiB`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
