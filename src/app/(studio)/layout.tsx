import type { ReactNode } from "react";

import { StudioShell } from "@/components/layout/studio-shell";

export default function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <StudioShell>{children}</StudioShell>;
}
