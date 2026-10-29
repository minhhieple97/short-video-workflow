"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, errorMessage, sendJson } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

import { BOOK_IMPORT_LABELS } from "../domain/book-import-status";
import type { BookImportDto } from "../schemas/book-import.dto";

export function BookImportProgress({ initial }: Readonly<{ initial: BookImportDto }>) {
  const [batch, setBatch] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const finished = ["COMPLETED", "PARTIAL", "CANCELLED"].includes(batch.status);

  useEffect(() => {
    if (finished) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        setBatch(await apiRequest<BookImportDto>(`/api/book-imports/${initial.id}`, { signal: controller.signal }));
        setError(null);
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3_000);
    };
    timer = setTimeout(() => void poll(), 3_000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [finished, initial.id]);

  async function action(value: "cancel" | "retry" | "start"): Promise<void> {
    setPending(true);
    try {
      setBatch(await sendJson<BookImportDto>(`/api/book-imports/${batch.id}`, "POST", { action: value }));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="font-medium" role="status">
        {BOOK_IMPORT_LABELS[batch.status] ?? batch.status} ·{" "}
        {batch.items.filter((item) => item.status === "COMPLETED").length}/{batch.items.length} sách hoàn tất
      </p>
      {!finished
        ? batch.cooldowns.map((cooldown) => (
            <Alert key={cooldown.provider}>
              <AlertDescription>
                {cooldown.message} Sẽ tự thử lại từ {formatDateTime(cooldown.blockedUntil)}.
              </AlertDescription>
            </Alert>
          ))
        : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ol className="flex flex-col gap-3">
        {batch.items.map((item) => (
          <li key={item.id} className="bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 line-clamp-2 font-medium wrap-break-word" title={item.fileName}>
                {item.position}. {item.fileName}
              </span>
              <Badge variant={item.status === "COMPLETED" ? "mint" : item.status === "FAILED" ? "rose" : "amber"}>
                {BOOK_IMPORT_LABELS[item.status] ?? item.status}
              </Badge>
            </div>
            {item.videosTotal > 0 ? (
              <p className="text-muted-foreground text-sm">
                Video hoàn tất: {item.videosCompleted}/{item.videosTotal}
              </p>
            ) : null}
            {item.errorMessage ? <p className="text-destructive text-sm wrap-break-word">{item.errorMessage}</p> : null}
            <div className="flex flex-wrap gap-3 text-sm">
              {item.bookId ? (
                <Link href={`/books/${item.bookId}`} className="underline">
                  Mở sách
                </Link>
              ) : null}
              {item.productionIds.map((id, index) => (
                <Link key={id} href={`/productions/${id}`} className="underline">
                  Video và Drive{item.productionIds.length > 1 ? ` (${index + 1})` : ""}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {batch.status === "UPLOADING" && batch.items.every((item) => item.bookId) ? (
          <Button disabled={pending} onClick={() => void action("start")}>
            Bắt đầu đợt nhập
          </Button>
        ) : null}
        {batch.status === "PARTIAL" ? (
          <Button disabled={pending} onClick={() => void action("retry")}>
            Thử lại các sách lỗi
          </Button>
        ) : null}
        {!finished ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={pending}>
                Huỷ đợt nhập
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Huỷ đợt nhập sách?</AlertDialogTitle>
                <AlertDialogDescription>
                  Các tác vụ chưa xong sẽ dừng. Sách, âm thanh và video đã tạo được giữ lại.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Quay lại</AlertDialogCancel>
                <AlertDialogAction onClick={() => void action("cancel")}>Huỷ đợt nhập</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
