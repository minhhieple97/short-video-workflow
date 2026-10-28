"use client";

import type { ReactNode } from "react";

import { UrlTabs, type UrlTab } from "@/components/layout/url-tabs";
import { useMediaQuery } from "@/lib/use-media-query";

const DOCK_QUERY = "(min-width: 1280px)";

interface EditorWorkspaceProps {
  tabs: readonly UrlTab[];
  active: string;
  preview: ReactNode;
}

// Wide screens keep the 9:16 preview docked beside the editor so every edit can be checked at a glance; narrower
// screens get it as the last tab. The Player is mounted in one place only: two Remotion Players are too heavy.
export function EditorWorkspace({ tabs, active, preview }: Readonly<EditorWorkspaceProps>) {
  const docked = useMediaQuery(DOCK_QUERY);
  const visibleTabs = docked ? tabs : [...tabs, { value: "preview", label: "Xem trước", content: preview }];
  const current = visibleTabs.some((tab) => tab.value === active) ? active : (visibleTabs[0]?.value ?? active);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
      <UrlTabs tabs={visibleTabs} active={current} />
      {docked ? (
        <aside aria-label="Xem trước video" className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
          {preview}
        </aside>
      ) : null}
    </div>
  );
}
