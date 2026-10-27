"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { BookSummary } from "../schemas/book.dto";

export function EditBookDialog({ book }: Readonly<{ book: BookSummary }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      await sendJson(`/api/books/${book.id}`, "PATCH", {
        title: String(form.get("title") ?? ""),
        author: String(form.get("author") ?? ""),
        description: String(form.get("description") ?? ""),
      });
      toast.success("Đã cập nhật thông tin sách.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil aria-hidden />
          Sửa thông tin
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Sửa thông tin sách</DialogTitle>
            <DialogDescription>Chỉ thay đổi thông tin hiển thị; tệp gốc không bị sửa.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="book-title">Tên sách</Label>
            <Input id="book-title" name="title" defaultValue={book.title} required maxLength={200} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="book-author">Tác giả</Label>
            <Input id="book-author" name="author" defaultValue={book.author ?? ""} maxLength={200} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="book-description">Mô tả</Label>
            <Textarea id="book-description" name="description" defaultValue={book.description ?? ""} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Lưu
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
