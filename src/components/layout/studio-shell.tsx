import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { Sidebar } from "./sidebar";

export function StudioShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <TooltipProvider>
      <div className="bg-background text-foreground flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-clip px-4 py-6 md:px-8 md:py-8 lg:px-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
