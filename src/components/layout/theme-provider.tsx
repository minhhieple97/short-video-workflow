"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export const THEME_STORAGE_KEY = "studio-theme";

// The `dark` class on <html> drives the tokens in globals.css; "system" follows prefers-color-scheme.
export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}
