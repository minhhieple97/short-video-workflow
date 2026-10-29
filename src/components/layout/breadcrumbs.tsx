import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const LABEL = "block max-w-56 truncate sm:max-w-xs";

export function Breadcrumbs({ items }: Readonly<{ items: readonly BreadcrumbItem[] }>) {
  return (
    <nav aria-label="Đường dẫn" className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
          {item.href ? (
            <Link
              href={item.href}
              title={item.label}
              className={cn(LABEL, "hover:text-primary font-medium transition-colors")}
            >
              {item.label}
            </Link>
          ) : (
            <span title={item.label} className={cn(LABEL, "text-foreground font-semibold")}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
