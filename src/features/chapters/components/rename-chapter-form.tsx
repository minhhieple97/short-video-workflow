"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, sendJson } from "@/lib/api-client";

export function RenameChapterForm({ chapterId, title }: Readonly<{ chapterId: string; title: string }>) {
  const router = useRouter();
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const changed = value.trim() !== title && value.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await sendJson(`/api/chapters/${chapterId}`, "PATCH", { title: value });
      toast.success("Đã đổi tên chương.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex max-w-2xl gap-2">
      <Input value={value} onChange={(event) => setValue(event.target.value)} aria-label="Tên chương" maxLength={200} />
      <Button type="submit" variant="outline" disabled={!changed || pending}>
        Đổi tên
      </Button>
    </form>
  );
}
