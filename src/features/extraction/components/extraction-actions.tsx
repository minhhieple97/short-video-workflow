"use client";

import { CircleDollarSign, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
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
import { errorMessage, sendJson } from "@/lib/api-client";

import { formatUsd } from "../domain/ocr-budget";
import type { ExtractionDto } from "../schemas/extraction.dto";

const REFRESH_MS = 3_000;

function CeilingDialog({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const router = useRouter();
  const { ocr } = extraction;
  const committed = ocr.spentMicroUsd + ocr.reservedMicroUsd;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(ocr.ceilingMicroUsd === null ? "3" : String(ocr.ceilingMicroUsd / 1_000_000));
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await sendJson(`/api/extractions/${extraction.id}/ocr-ceiling`, "PUT", { ceilingUsd: Number(value) });
      toast.success("Đã lưu trần chi phí OCR.", {
        description: extraction.held ? "Bấm “Thử lại” để tiếp tục trích xuất với trần mới." : undefined,
      });
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
          <CircleDollarSign aria-hidden />
          Trần chi phí OCR
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Trần chi phí OCR cho sách này</DialogTitle>
            <DialogDescription>
              Ứng dụng không bao giờ tự nâng trần. Trần không thể thấp hơn khoản đã chi hoặc đang giữ chỗ (
              {formatUsd(committed)}).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ocr-ceiling">Trần (USD)</Label>
            <Input
              id="ocr-ceiling"
              type="number"
              inputMode="decimal"
              min={committed / 1_000_000}
              max={100}
              step={0.01}
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Lưu trần
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Retry and ceiling controls, plus a quiet refresh while the worker is still on the run so the page follows it.
export function ExtractionActions({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const running = extraction.activeJob !== null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  async function retry(): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/extractions/${extraction.id}/retry`, "POST");
      toast.success("Đã xếp lịch trích xuất lại; các trang đã đọc được giữ nguyên.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (!extraction.canRetry && !extraction.canSetCeiling) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {extraction.canRetry ? (
        <Button onClick={() => void retry()} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
          Thử lại
        </Button>
      ) : null}
      {extraction.canSetCeiling ? <CeilingDialog extraction={extraction} /> : null}
    </div>
  );
}
