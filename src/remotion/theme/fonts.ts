import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

const LATIN_RANGE =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const VIETNAMESE_RANGE =
  "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB";

let loading: Promise<unknown> | null = null;

// Same bundled font in the browser preview and the headless render, so Vietnamese diacritics look identical.
export function ensureFonts(): Promise<unknown> {
  if (typeof window === "undefined") return Promise.resolve();
  loading ??= Promise.all(
    (["500", "800"] as const).flatMap((weight) => [
      loadFont({
        family: "Be Vietnam Pro",
        url: staticFile(`fonts/be-vietnam-pro-latin-${weight}-normal.woff2`),
        weight,
        unicodeRange: LATIN_RANGE,
      }),
      loadFont({
        family: "Be Vietnam Pro",
        url: staticFile(`fonts/be-vietnam-pro-vietnamese-${weight}-normal.woff2`),
        weight,
        unicodeRange: VIETNAMESE_RANGE,
      }),
    ]),
  );
  return loading;
}
