"use client";

import { Copy, Info, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { errorMessage, sendJson } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, isJobType, type JobListItem } from "@/shared/types/job";

function Row({ label, value }: Readonly<{ label: string; value: string | number | null }>) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{value ?? "—"}</dd>
    </div>
  );
}

export function JobActions({ job }: Readonly<{ job: JobListItem }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function act(action: "retry" | "cancel"): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/jobs/${job.id}/${action}`, "POST");
      toast.success(action === "retry" ? "Đã tạo tác vụ thử lại." : "Đã gửi yêu cầu huỷ.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      {job.canRetry ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => void act("retry")}>
          <RotateCcw aria-hidden /> Thử lại
        </Button>
      ) : null}
      {job.canCancel ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => void act("cancel")}
        >
          <X aria-hidden /> Huỷ
        </Button>
      ) : null}
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="Chi tiết">
            <Info aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isJobType(job.jobType) ? JOB_TYPE_LABELS[job.jobType] : job.jobType}</DialogTitle>
            <DialogDescription>{job.entityLabel}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row label="Mã tác vụ" value={job.id} />
            <Row label="Trạng thái" value={JOB_STATUS_LABELS[job.status]} />
            <Row label="Tiến độ" value={`${job.progress}%`} />
            <Row label="Số lần chạy" value={job.attempts} />
            <Row label="Tạo lúc" value={formatDateTime(job.createdAt)} />
            <Row label="Bắt đầu" value={job.startedAt ? formatDateTime(job.startedAt) : null} />
            <Row label="Kết thúc" value={job.completedAt ? formatDateTime(job.completedAt) : null} />
            <Row label="Mã lỗi" value={job.errorCode} />
            <Row label="Lỗi" value={job.errorMessage} />
          </dl>
          {job.cliCommand ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>Chạy lệnh sau trong terminal WSL (Claude Code đã đăng nhập) để hoàn tất:</p>
              <div className="bg-muted flex items-center gap-2 rounded-md p-2 font-mono text-xs">
                <code className="flex-1 break-all">{job.cliCommand}</code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sao chép lệnh"
                  onClick={() =>
                    void navigator.clipboard.writeText(job.cliCommand ?? "").then(() => toast.success("Đã sao chép."))
                  }
                >
                  <Copy aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
