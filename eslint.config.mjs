import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";

const SERVER_ONLY_IMPORTS = [
  { group: ["@/server/*", "@/generated/*"], message: "Server-side code must not be imported here." },
  {
    group: ["bullmq", "ioredis", "@prisma/*", "node:*", "fs", "child_process"],
    message: "Node/server APIs are not allowed here.",
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "data/**",
    ".agents/**",
    ".claude/**",
  ]),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["scripts/**/*.ts", "prisma/seed.ts", "src/shared/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/*/components/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: SERVER_ONLY_IMPORTS }] },
  },
  {
    // A render is made from the snapshot captured when it was requested. Reaching for the live video here would let an
    // edit made meanwhile leak into it, so these modules are off limits to the runner.
    files: ["src/features/videos/services/render-runner.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "./video.service",
                "./video-mapper",
                "../repositories/video.repository",
                "./script-editing.service",
              ],
              message: "The render runner reads its RenderSnapshot, never the live video.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/remotion/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...SERVER_ONLY_IMPORTS,
            {
              group: ["@/features/*/services/*", "@/features/*/repositories/*"],
              message: "Remotion code receives props only.",
            },
            {
              group: [
                "@remotion/google-fonts*",
                "@remotion/effects*",
                "@remotion/light-leaks*",
                "@remotion/motion-blur*",
                "@remotion/three*",
                "@remotion/lottie*",
                "@remotion/rive*",
                "react-peeps",
              ],
              message: "Network, WebGL or runtime art packages are not used in the video (see AGENTS.md §11).",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Remotion code must not read process.env." },
        { object: "Math", property: "random", message: "Frames must be deterministic: use a seed or the frame." },
        { object: "Date", property: "now", message: "Frames must not depend on the clock." },
      ],
    },
  },
]);
