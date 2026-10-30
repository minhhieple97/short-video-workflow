"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { IconButton } from "@/components/layout/icon-button";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { pageWindow, type Page } from "@/shared/pagination";

// Pager for a list the server cut into pages. Every link keeps the rest of the address (tab, filters, search), and
// `param` names this list's page so several lists on one page (the book's tabs) page independently.
export function Pagination({
  page,
  param = "page",
}: Readonly<{ page: Pick<Page<unknown>, "page" | "pageCount" | "pageSize" | "total">; param?: string }>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pageCount, total, pageSize } = page;
  if (pageCount <= 1) return null;

  function hrefFor(target: number): string {
    const next = new URLSearchParams(searchParams);
    if (target <= 1) next.delete(param);
    else next.set(param, String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  const first = (page.page - 1) * pageSize + 1;
  const last = Math.min(page.page * pageSize, total);
  const hasPrevious = page.page > 1;
  const hasNext = page.page < pageCount;

  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground tabular-nums">
        {formatNumber(first)}–{formatNumber(last)} / {formatNumber(total)}
      </p>
      <ul className="flex items-center gap-1">
        <li>
          {hasPrevious ? (
            <IconButton asChild label="Trang trước" variant="outline" size="icon-sm">
              <Link href={hrefFor(page.page - 1)} prefetch={false}>
                <ChevronLeft aria-hidden />
              </Link>
            </IconButton>
          ) : (
            <IconButton label="Trang trước" note="Đang ở trang đầu" variant="outline" size="icon-sm" disabled>
              <ChevronLeft aria-hidden />
            </IconButton>
          )}
        </li>
        {pageWindow(page.page, pageCount).map((entry, index) =>
          entry === null ? (
            <li key={`gap-${index}`} aria-hidden className="text-muted-foreground px-1">
              …
            </li>
          ) : (
            <li key={entry}>
              <Button
                asChild
                size="sm"
                variant={entry === page.page ? "default" : "outline"}
                className="min-w-8 tabular-nums"
              >
                <Link
                  href={hrefFor(entry)}
                  prefetch={false}
                  aria-label={`Trang ${entry}`}
                  aria-current={entry === page.page ? "page" : undefined}
                >
                  {entry}
                </Link>
              </Button>
            </li>
          ),
        )}
        <li>
          {hasNext ? (
            <IconButton asChild label="Trang sau" variant="outline" size="icon-sm">
              <Link href={hrefFor(page.page + 1)} prefetch={false}>
                <ChevronRight aria-hidden />
              </Link>
            </IconButton>
          ) : (
            <IconButton label="Trang sau" note="Đang ở trang cuối" variant="outline" size="icon-sm" disabled>
              <ChevronRight aria-hidden />
            </IconButton>
          )}
        </li>
      </ul>
    </nav>
  );
}
