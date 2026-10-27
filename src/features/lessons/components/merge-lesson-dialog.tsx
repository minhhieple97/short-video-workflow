"use client";

import { Merge } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage, sendJson } from "@/lib/api-client";

interface MergeLessonDialogProps {
  lessonId: string;
  bookId: string;
  candidates: readonly { id: string; title: string }[];
  disabledReason: string | null;
}

export function MergeLessonDialog({ lessonId, bookId, candidates, disabledReason }: Readonly<MergeLessonDialogProps>) {
  const router = useRouter();
  const [target, setTarget] = useState<string>("");
  const [pending, setPending] = useState(false);

  async function merge(): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/lessons/${lessonId}/merge`, "POST", { targetLessonId: target });
      toast.success("Đã gộp bài học. Bài học này đã được lưu trữ.");
      router.push(`/books/${bookId}/lessons/${target}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={disabledReason !== null || candidates.length === 0}
          title={disabledReason ?? undefined}
        >
          <Merge aria-hidden />
          Gộp vào bài học khác
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gộp bài học trùng ý</DialogTitle>
          <DialogDescription>
            Nguồn trích dẫn của bài học này sẽ được chuyển sang bài học đích; bài học này sẽ được lưu trữ. Nội dung bài
            học đích giữ nguyên.
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger aria-label="Bài học đích">
            <SelectValue placeholder="Chọn bài học đích" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="destructive" disabled={!target || pending} onClick={() => void merge()}>
            Xác nhận gộp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
