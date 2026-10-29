"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface UrlTab {
  value: string;
  label: string;
  content: ReactNode;
}

// Tabs whose active value lives in ?tab= so refreshes and shared links keep the same tab. Every panel is already on the
// page, so a click switches at once and only rewrites the address (Next keeps its router in step with replaceState);
// waiting for the server to render the page again made the tabs look frozen.
export function UrlTabs({ tabs, active }: Readonly<{ tabs: readonly UrlTab[]; active: string }>) {
  const pathname = usePathname();
  const [selected, setSelected] = useState(active);
  const [lastActive, setLastActive] = useState(active);
  // A new tab from the server (a link with another ?tab=) wins over the one picked here.
  if (active !== lastActive) {
    setLastActive(active);
    setSelected(active);
  }

  // A tab can disappear (the editor docks its preview on wide screens); fall back instead of showing nothing.
  const has = (value: string) => tabs.some((tab) => tab.value === value);
  const current = has(selected) ? selected : has(active) ? active : (tabs[0]?.value ?? active);

  function select(tab: string): void {
    setSelected(tab);
    window.history.replaceState(null, "", `${pathname}?tab=${tab}`);
  }

  return (
    <Tabs value={current} onValueChange={select}>
      <TabsList variant="line" className="overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="pt-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
