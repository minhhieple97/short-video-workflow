import type { ReactNode } from "react";

import { UrlTabs } from "@/components/layout/url-tabs";

import { BOOK_TABS, type BookTab } from "./book-tab-values";

interface BookTabsProps {
  activeTab: BookTab;
  counts: Record<BookTab, number>;
  panels: Record<BookTab, ReactNode>;
}

const LABELS: Record<BookTab, string> = { chapters: "Chương", lessons: "Bài học", videos: "Video" };

export function BookTabs({ activeTab, counts, panels }: Readonly<BookTabsProps>) {
  return (
    <UrlTabs
      active={activeTab}
      tabs={BOOK_TABS.map((tab) => ({ value: tab, label: `${LABELS[tab]} (${counts[tab]})`, content: panels[tab] }))}
    />
  );
}
