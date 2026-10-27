import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function StudioNotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">Không tìm thấy</h1>
      <p className="text-muted-foreground text-sm">Nội dung bạn tìm không tồn tại hoặc đã bị xoá.</p>
      <Button asChild variant="outline">
        <Link href="/books">Về thư viện sách</Link>
      </Button>
    </div>
  );
}
