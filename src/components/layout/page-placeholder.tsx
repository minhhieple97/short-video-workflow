import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PagePlaceholderProps {
  title: string;
  description: string;
  milestone: string;
  children?: ReactNode;
}

export function PagePlaceholder({ title, description, milestone, children }: Readonly<PagePlaceholderProps>) {
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </header>
      <Alert>
        <AlertTitle>Chưa triển khai</AlertTitle>
        <AlertDescription>Màn hình này sẽ được xây dựng ở {milestone}.</AlertDescription>
      </Alert>
      {children}
    </section>
  );
}
