import type { PreflightReport } from "../../domain/preflight";

export function PreflightList({ title, report }: Readonly<{ title: string; report: PreflightReport }>) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">
        {title} · {report.totalSeconds}s
      </p>
      {report.blocking.length === 0 && report.warnings.length === 0 ? (
        <p className="text-emerald-700 dark:text-emerald-400">Sẵn sàng render.</p>
      ) : null}
      {report.blocking.length > 0 ? (
        <ul className="list-disc pl-5 text-red-600 dark:text-red-400">
          {report.blocking.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      {report.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">
          {report.warnings.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
