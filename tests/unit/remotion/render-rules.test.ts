import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REMOTION_DIR = path.join(process.cwd(), "src/remotion");

// Comments may name sources and licences; only code counts.
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sources(): [string, string][] {
  return fs
    .readdirSync(REMOTION_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => [file, withoutComments(fs.readFileSync(path.join(REMOTION_DIR, file), "utf8"))]);
}

// What would make the preview and the MP4 differ, a render depend on the network or the clock, or a frame slow on a
// machine without a GPU.
const FORBIDDEN: [string, RegExp][] = [
  ["Math.random", /Math\.random/],
  ["the clock", /Date\.now|new Date\(|performance\.now/],
  ["network", /fetch\(|https?:\/\//],
  ["CSS animation", /\b(transition|animation):\s*["'`]|@keyframes/],
  ["filters", /<filter|filter[=:{]|blur\(|backdropFilter/],
  ["images", /<img|<Img\b|<image/],
  [
    "forbidden Remotion packages",
    /@remotion\/(google-fonts|light-leaks|effects|motion-blur|three|lottie|rive|animated-emoji|gif|starburst)/,
  ],
  ["WebGL transitions", /@remotion\/transitions\/(?!(fade|slide|wipe|none)["'])[\w-]+/],
];

describe("Remotion code rules", () => {
  it.each(FORBIDDEN)("never uses %s", (_, pattern) => {
    const offending = sources()
      .filter(([, source]) => pattern.test(source))
      .map(([file]) => file);
    expect(offending).toEqual([]);
  });
});
