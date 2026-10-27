"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BOOK_TABS, type BookTab } from "./book-tab-values";

interface BookTabsProps {
  activeTab: BookTab;
  counts: Record<BookTab, number>;
  panels: Record<BookTab, ReactNode>;
}

const LABELS: Record<BookTab, string> = { chapters: "Chương", lessons: "Bài học", videos: "Video" };

export function BookTabs({ activeTab, counts, panels }: Readonly<BookTabsProps>) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Tabs value={activeTab} onValueChange={(tab) => router.replace(`${pathname}?tab=${tab}`, { scroll: false })}>
      <TabsList>
        {BOOK_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {LABELS[tab]} ({counts[tab]})
          </TabsTrigger>
        ))}
      </TabsList>
      {BOOK_TABS.map((tab) => (
        <TabsContent key={tab} value={tab} className="pt-4">
          {panels[tab]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
