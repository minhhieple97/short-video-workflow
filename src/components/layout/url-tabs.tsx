"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface UrlTab {
  value: string;
  label: string;
  content: ReactNode;
}

// Tabs whose active value lives in ?tab= so refreshes and shared links keep the same tab.
export function UrlTabs({ tabs, active }: Readonly<{ tabs: readonly UrlTab[]; active: string }>) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Tabs value={active} onValueChange={(tab) => router.replace(`${pathname}?tab=${tab}`, { scroll: false })}>
      <TabsList>
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
