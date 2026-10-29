"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { IconButton } from "@/components/layout/icon-button";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { BookSummary } from "../schemas/book.dto";

export function DeleteBookButton({ book }: Readonly<{ book: BookSummary }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const blocked = book.videoCount > 0;

  async function handleDelete(): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/books/${book.id}`, "DELETE");
      toast.success(`Đã xoá "${book.title}" khỏi thư viện.`);
      router.push("/books");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <IconButton label="Xoá sách" variant="outline" className="text-destructive">
          <Trash2 aria-hidden />
        </IconButton>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{blocked ? "Chưa thể xoá sách này" : `Xoá "${book.title}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? `Sách đang có ${book.videoCount} video. Hãy xoá các video trước để tránh mất nguồn bài học của chúng.`
              : `Sách sẽ bị ẩn khỏi thư viện cùng ${book.chapterCount} chương và ${book.lessonCount} bài học. Tệp gốc và dữ liệu vẫn được giữ trên ổ đĩa, không bị xoá vĩnh viễn.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          {blocked ? null : (
            <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void handleDelete()}>
              Xoá sách
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
