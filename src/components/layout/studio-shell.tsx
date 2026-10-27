import type { ReactNode } from "react";

import { SidebarNav } from "./sidebar-nav";

export function StudioShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <aside className="border-border hidden w-60 shrink-0 flex-col gap-6 border-r p-4 md:flex">
        <div>
          <p className="text-base font-semibold">Book Video Studio</p>
          <p className="text-muted-foreground text-xs">Video ngắn 9:16 từ bài học sách</p>
        </div>
        <SidebarNav />
      </aside>
      <main className="flex-1 overflow-x-hidden p-6 lg:p-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
