import path from "node:path";

import type { WebpackOverrideFn } from "@remotion/bundler";

// Lets Remotion code import pure modules through the same "@/" alias as the app (no server code is imported).
export const withAppAlias: WebpackOverrideFn = (config) => {
  const existing = config.resolve?.alias;
  const alias = existing && !Array.isArray(existing) ? existing : {};
  return {
    ...config,
    resolve: { ...config.resolve, alias: { ...alias, "@": path.join(process.cwd(), "src") } },
  };
};
