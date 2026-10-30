import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Pagination } from "@/components/layout/pagination";
import { TooltipProvider } from "@/components/ui/tooltip";

const navigation = vi.hoisted(() => ({ pathname: "/books/b1", search: "tab=lessons&status=DRAFT" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

function render(page: { page: number; pageCount: number; total: number; pageSize: number }, param?: string) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Pagination page={page} param={param} />
    </TooltipProvider>,
  );
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

describe("Pagination", () => {
  beforeEach(() => {
    navigation.pathname = "/books/b1";
    navigation.search = "tab=lessons&status=DRAFT";
  });

  it("draws nothing when everything fits on one page", () => {
    expect(render({ page: 1, pageCount: 1, total: 12, pageSize: 25 })).toBe("");
  });

  it("links every page while keeping the rest of the address, and drops the parameter for page 1", () => {
    const html = render({ page: 2, pageCount: 3, total: 60, pageSize: 25 }, "lessonPage");

    expect(hrefs(html)).toEqual([
      "/books/b1?tab=lessons&amp;status=DRAFT",
      "/books/b1?tab=lessons&amp;status=DRAFT",
      "/books/b1?tab=lessons&amp;status=DRAFT&amp;lessonPage=2",
      "/books/b1?tab=lessons&amp;status=DRAFT&amp;lessonPage=3",
      "/books/b1?tab=lessons&amp;status=DRAFT&amp;lessonPage=3",
    ]);
  });

  it("replaces this list's page number and leaves another list's alone", () => {
    navigation.search = "tab=videos&lessonPage=4&videoPage=2";
    const html = render({ page: 2, pageCount: 3, total: 60, pageSize: 25 }, "videoPage");

    expect(hrefs(html)).toContain("/books/b1?tab=videos&amp;lessonPage=4&amp;videoPage=3");
    expect(hrefs(html)).toContain("/books/b1?tab=videos&amp;lessonPage=4");
  });

  it("says which rows are shown, marks the current page and switches off the arrow with nowhere to go", () => {
    const html = render({ page: 1, pageCount: 3, total: 60, pageSize: 25 });

    expect(html).toContain("1–25 / 60");
    expect(html).toMatch(/aria-current="page"[^>]*>1</);
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Trang trước/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*aria-label="Trang sau/);
    expect(render({ page: 3, pageCount: 3, total: 60, pageSize: 25 })).toContain("51–60 / 60");
  });
});
