import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BATCH_STATUS_LABELS } from "@/features/productions/domain/production-labels";
import { listProductions } from "@/features/productions/services/production-view.service";
import { formatRange } from "@/features/videos/domain/duration";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProductionsPage() {
  const productions = await listProductions();

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Sản xuất"
        description="Các đợt sản xuất video từ bài học đã chọn. Bắt đầu đợt mới từ trang của một cuốn sách."
      />
      {productions.length === 0 ? (
        <EmptyState
          title="Chưa có đợt sản xuất"
          description="Mở một cuốn sách và bấm “Sản xuất video” để chọn các bài học cần làm video."
          action={
            <Link href="/books" className="text-sm font-medium hover:underline">
              Tới thư viện sách
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sách</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-right">Video xong</TableHead>
              <TableHead>Khoảng thời lượng</TableHead>
              <TableHead>Tạo lúc</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productions.map((production) => {
              const status = BATCH_STATUS_LABELS[production.status];
              return (
                <TableRow key={production.id}>
                  <TableCell>
                    <Link href={`/productions/${production.id}`} className="font-medium hover:underline">
                      {production.book.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={status.tone}>{status.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {production.completedCount}/{production.itemCount}
                  </TableCell>
                  <TableCell>{formatRange(production)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(production.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
