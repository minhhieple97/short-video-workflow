import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JobTable } from "@/features/jobs/components/job-table";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import { listJobsForDashboard } from "@/features/jobs/services/job-dashboard.service";
import { checkWorkerHeartbeat } from "@/server/diagnostics/checks/worker-heartbeat";

export const dynamic = "force-dynamic";

const ACTIVE = new Set(["QUEUED", "RUNNING", "CANCEL_REQUESTED", "WAITING_FOR_CLI"]);

export default async function JobsPage() {
  const [jobs, worker] = await Promise.all([listJobsForDashboard(), checkWorkerHeartbeat()]);
  const hasActive = jobs.some((job) => ACTIVE.has(job.status));

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
      <JobTable jobs={jobs} />
    </section>
  );
}
