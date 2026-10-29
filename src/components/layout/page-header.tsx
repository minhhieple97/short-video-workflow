import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

// Past this length a title is a sentence rather than a name: it is set smaller and cut at three lines, with the whole
// text in the tooltip.
const LONG_TITLE_CHARS = 80;

export function PageHeader({ title, description, actions }: Readonly<PageHeaderProps>) {
  const long = title.length > LONG_TITLE_CHARS;
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1 basis-80">
        <h1
          title={long ? title : undefined}
          className={cn(
            "line-clamp-3 font-extrabold tracking-tight wrap-break-word",
            long ? "text-xl leading-snug sm:text-2xl" : "text-3xl",
          )}
        >
          {title}
        </h1>
        {description ? <div className="text-muted-foreground mt-1.5 text-sm wrap-break-word">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
