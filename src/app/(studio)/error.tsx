"use client";

import { Button } from "@/components/ui/button";

export default function StudioError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">Đã xảy ra lỗi</h1>
      <p className="text-muted-foreground text-sm">{error.message || "Không thể tải trang này."}</p>
      <Button onClick={reset}>Thử lại</Button>
    </div>
  );
}
