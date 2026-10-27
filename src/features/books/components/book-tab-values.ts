export const BOOK_TABS = ["chapters", "lessons", "videos"] as const;
export type BookTab = (typeof BOOK_TABS)[number];

export function toBookTab(value: string | undefined): BookTab {
  return BOOK_TABS.find((tab) => tab === value) ?? "chapters";
}
