import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Book Video Studio",
  description: "Biến bài học từ sách thành video ngắn dọc 9:16.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
