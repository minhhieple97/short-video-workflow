import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

import { PROP_IDS, type PropId } from "@/features/videos/domain/props";

// Turns Microsoft Fluent Emoji "Flat" SVGs (MIT) into plain shape data for src/remotion/props/prop-art.generated.ts, one
// entry per PropId. Reads a local copy of the repository's assets folder (no network):
//   pnpm props:generate --source /path/to/fluentui-emoji/assets
// Only flat fills are accepted: a gradient, filter, mask, image, style, text or <use> fails the run.

const OUTPUT = path.join(process.cwd(), "src/remotion/props/prop-art.generated.ts");

const MANIFEST: Record<PropId, string> = {
  MOBILE_PHONE: "Mobile phone",
  LAPTOP: "Laptop",
  DESKTOP_COMPUTER: "Desktop computer",
  TELEVISION: "Television",
  HEADPHONE: "Headphone",
  ALARM_CLOCK: "Alarm clock",
  SPIRAL_CALENDAR: "Spiral calendar",
  HOURGLASS: "Hourglass done",
  MONEY_BAG: "Money bag",
  COIN: "Coin",
  CREDIT_CARD: "Credit card",
  MONEY_WITH_WINGS: "Money with wings",
  BRIEFCASE: "Briefcase",
  CHART_UP: "Chart increasing",
  CHART_DOWN: "Chart decreasing",
  MEMO: "Memo",
  BOOKS: "Books",
  OPEN_BOOK: "Open book",
  CLOSED_BOOK: "Closed book",
  NOTEBOOK: "Notebook",
  PENCIL: "Pencil",
  GRADUATION_CAP: "Graduation cap",
  BACKPACK: "Backpack",
  HOT_BEVERAGE: "Hot beverage",
  TEACUP: "Teacup without handle",
  PIZZA: "Pizza",
  NOODLE_BOWL: "Steaming bowl",
  APPLE: "Green apple",
  CAKE: "Shortcake",
  RUNNING_SHOE: "Running shoe",
  PILL: "Pill",
  BED: "Bed",
  COUCH_AND_LAMP: "Couch and lamp",
  CHAIR: "Chair",
  POTTED_PLANT: "Potted plant",
  FRAMED_PICTURE: "Framed picture",
  SHOPPING_BAGS: "Shopping bags",
  GIFT: "Wrapped gift",
  KEY: "Key",
  LOCK: "Locked",
  ENVELOPE: "Envelope",
  BELL: "Bell",
  SPEECH_BALLOON: "Speech balloon",
  THOUGHT_BALLOON: "Thought balloon",
  HEART: "Red heart",
  LIGHT_BULB: "Light bulb",
  TARGET: "Bullseye",
  TROPHY: "Trophy",
  FIRE: "Fire",
  STAR: "Star",
  SPARKLES: "Sparkles",
  PARTY_POPPER: "Party popper",
  CHECK: "Check mark button",
  CROSS: "Cross mark",
  WARNING: "Warning",
  QUESTION_MARK: "Red question mark",
  EXCLAMATION_MARK: "Red exclamation mark",
  ROCKET: "Rocket",
  SEEDLING: "Seedling",
  MOUNTAIN: "Mountain",
  BRAIN: "Brain",
  ZZZ: "Zzz",
  TREE: "Deciduous tree",
  PINE_TREE: "Evergreen tree",
  HOUSE: "House",
  OFFICE_BUILDING: "Office building",
  SCHOOL: "School",
  BUS: "Bus",
  CAR: "Automobile",
  BICYCLE: "Bicycle",
  SHOPPING_CART: "Shopping cart",
};

const MAX_SHAPES = 40;
type Shape = (string | number)[];

const { values } = parseArgs({ options: { source: { type: "string" } }, strict: true });

function attributes(tag: string): Map<string, string> {
  return new Map([...tag.matchAll(/ ([\w:-]+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

const compact = (d: string) =>
  d
    .replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (number) => String(Math.round(Number(number) * 100) / 100))
    .replace(/\s+/g, " ")
    .trim();

const NAMED_COLORS: Record<string, string> = { white: "#FFFFFF", black: "#000000" };

function color(value: string | undefined, where: string): string {
  const hex = value ? (NAMED_COLORS[value] ?? value) : "";
  if (!/^#[0-9A-Fa-f]{3,8}$/.test(hex)) throw new Error(`${where}: fill must be a hex colour, got "${value}"`);
  return hex.toUpperCase();
}

function shapesOf(id: PropId, svg: string): Shape[] {
  if (!/viewBox="0 0 32 32"/.test(svg)) throw new Error(`${id}: viewBox must be 0 0 32 32`);
  const shapes: Shape[] = [];
  for (const [tag] of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const element = /^<([a-zA-Z]+)/.exec(tag)?.[1] ?? "";
    const attrs = attributes(tag);
    if (element === "svg") continue;
    if (element === "path") {
      const d = attrs.get("d") ?? "";
      if (!/^[MmLlHhVvCcSsQqTtAaZz\d\s.,e-]+$/.test(d)) throw new Error(`${id}: unexpected path data`);
      shapes.push([
        "p",
        compact(d),
        color(attrs.get("fill"), id),
        attrs.get("fill-rule") === "evenodd" ? 1 : 0,
        Number(attrs.get("opacity") ?? 1),
      ]);
    } else if (element === "rect") {
      const n = (name: string) => Number(attrs.get(name) ?? 0);
      shapes.push(["r", n("x"), n("y"), n("width"), n("height"), n("rx"), color(attrs.get("fill"), id)]);
    } else if (element === "circle") {
      const n = (name: string) => Number(attrs.get(name) ?? 0);
      shapes.push(["c", n("cx"), n("cy"), n("r"), color(attrs.get("fill"), id)]);
    } else if (element === "ellipse") {
      const n = (name: string) => Number(attrs.get(name) ?? 0);
      const transform = attrs.get("transform") ?? "";
      if (transform && !/^rotate\([-\d.\s]+\)$/.test(transform)) throw new Error(`${id}: unsupported transform`);
      shapes.push(["e", n("cx"), n("cy"), n("rx"), n("ry"), color(attrs.get("fill"), id), transform]);
    } else {
      throw new Error(`${id}: unsupported element <${element}>`);
    }
  }
  if (shapes.length === 0 || shapes.length > MAX_SHAPES) throw new Error(`${id}: ${shapes.length} shapes`);
  return shapes;
}

async function main() {
  if (!values.source) throw new Error("Usage: pnpm props:generate --source <fluentui-emoji/assets>");
  const art: Record<string, Shape[]> = {};
  for (const id of PROP_IDS) {
    const folder = MANIFEST[id];
    const file = `${folder.toLowerCase().replace(/ /g, "_")}_flat.svg`;
    art[id] = shapesOf(id, await fs.readFile(path.join(values.source, folder, "Flat", file), "utf8"));
  }
  const source = [
    "// Microsoft Fluent Emoji (Flat), Copyright (c) Microsoft Corporation, MIT License; see THIRD_PARTY_NOTICES.md.",
    "// Generated by scripts/generate-prop-art.ts from the files named in its manifest: do not edit by hand.",
    "// Shapes in a 32x32 box: [p, d, fill, evenOdd, opacity] | [r, x, y, w, h, rx, fill] | [c, cx, cy, r, fill]",
    "// | [e, cx, cy, rx, ry, fill, transform].",
    "",
    'import type { PropId } from "@/features/videos/domain/props";',
    "",
    'import type { PropShape } from "./prop-shape";',
    "",
    `export const PROP_ART = ${JSON.stringify(art)} as const satisfies Record<PropId, readonly PropShape[]>;`,
    "",
  ].join("\n");
  if (!/^[\x20-\x7E\n]*$/.test(source)) throw new Error("Generated art must be ASCII");
  await fs.writeFile(OUTPUT, source);
  await promisify(execFile)("pnpm", ["exec", "prettier", "--write", OUTPUT]);
  console.log(`${OUTPUT}: ${PROP_IDS.length} props, ${Math.round(source.length / 1024)} KiB`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
