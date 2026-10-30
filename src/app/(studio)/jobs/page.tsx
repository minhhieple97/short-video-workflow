import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JobTable } from "@/features/jobs/components/job-table";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import { countActiveJobRecords } from "@/features/jobs/repositories/job-record.repository";
import { listJobsPage } from "@/features/jobs/services/job-dashboard.service";
import { checkWorkerHeartbeat } from "@/server/diagnostics/checks/worker-heartbeat";
import { toPageRequest } from "@/shared/pagination";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: Readonly<{ searchParams: Promise<{ page?: string }> }>) {
  const { page } = await searchParams;
  const [jobs, activeCount, worker] = await Promise.all([
    listJobsPage(toPageRequest(page)),
    countActiveJobRecords(),
    checkWorkerHeartbeat(),
  ]);
  // Counted over every job, not the shown page: a job still running on another page keeps this page following it.
  const hasActive = activeCount > 0;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Tác vụ"
        description="Phân tích, kịch bản, giọng đọc và render chạy nền lần lượt (worker concurrency = 1). Trang tự cập nhật khi có tác vụ đang chạy."
      />
      {worker.status !== "ok" ? (
        <Alert variant="destructive">
          <AlertTitle>Worker không chạy</AlertTitle>
          <AlertDescription>
            {worker.summary} Các tác vụ vẫn nằm trong hàng đợi và sẽ chạy khi worker hoạt động lại.
          </AlertDescription>
        </Alert>
      ) : null}
      <JobsAutoRefresh active={hasActive} />
      <JobTable jobs={jobs.items} />
      <Pagination page={jobs} />
    </section>
  );
}
