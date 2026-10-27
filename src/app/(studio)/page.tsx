import Link from "next/link";

import { PagePlaceholder } from "@/components/layout/page-placeholder";

export default function DashboardPage() {
  return (
    <PagePlaceholder
      title="Tổng quan"
      description="Sách, video và tác vụ gần đây sẽ hiển thị tại đây."
      milestone="M1–M5"
    >
      <p className="text-muted-foreground text-sm">
        Kiểm tra trạng thái hệ thống tại{" "}
        <Link href="/settings" className="text-foreground underline underline-offset-4">
          Cài đặt
        </Link>
        .
      </p>
    </PagePlaceholder>
  );
}
