import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDuration } from "@/lib/format";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, isJobType, type JobListItem, type JobStatus } from "@/shared/types/job";

import { JobActions } from "./job-actions";

const STATUS_VARIANT: Record<JobStatus, "amber" | "blue" | "violet" | "mint" | "rose" | "slate"> = {
  QUEUED: "amber",
  WAITING_FOR_CLI: "blue",
  RUNNING: "violet",
  COMPLETED: "mint",
  FAILED: "rose",
  CANCEL_REQUESTED: "slate",
  CANCELLED: "slate",
};

export function JobTable({ jobs }: Readonly<{ jobs: readonly JobListItem[] }>) {
  if (jobs.length === 0)
    return (
      <EmptyState
        title="Chưa có tác vụ nào"
        description="Phân tích chương, tạo kịch bản, giọng đọc hoặc render sẽ xuất hiện ở đây."
      />
    );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tác vụ</TableHead>
          <TableHead>Đối tượng</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right">Tiến độ</TableHead>
          <TableHead>Thời gian</TableHead>
          <TableHead className="text-right">Thao tác</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-medium">
              {isJobType(job.jobType) ? JOB_TYPE_LABELS[job.jobType] : job.jobType}
            </TableCell>
            <TableCell className="max-w-xs whitespace-normal">
              {job.entityHref ? (
                <Link
                  href={job.entityHref}
                  title={job.entityLabel}
                  className="line-clamp-2 wrap-break-word hover:underline"
                >
                  {job.entityLabel}
                </Link>
              ) : (
                <span title={job.entityLabel} className="line-clamp-2 wrap-break-word">
                  {job.entityLabel}
                </span>
              )}
            </TableCell>
            <TableCell className="max-w-xs whitespace-normal">
              <Badge variant={STATUS_VARIANT[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
              {job.errorMessage ? (
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{job.errorMessage}</p>
              ) : null}
              {job.cliCommand ? <p className="mt-1 font-mono text-xs">{job.cliCommand}</p> : null}
            </TableCell>
            <TableCell className="min-w-28">
              {job.status === "WAITING_FOR_CLI" ? (
                <span className="text-muted-foreground block text-right">—</span>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <div className="bg-tone-violet h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
                    <div className="bg-primary h-full rounded-full" style={{ width: `${job.progress}%` }} />
                  </div>
                  <span className="w-9 text-right tabular-nums">{job.progress}%</span>
                </div>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
              <div>{formatDateTime(job.createdAt)}</div>
              {job.startedAt && job.completedAt ? (
                <div>Chạy {formatDuration(job.startedAt, job.completedAt)}</div>
              ) : null}
            </TableCell>
            <TableCell>
              <JobActions job={job} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
