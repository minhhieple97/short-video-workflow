import type { JobRecord } from "@/generated/prisma/client";
import type { JobDto } from "@/shared/types/job";

export function toJobDto(record: JobRecord): JobDto {
  return {
    id: record.id,
    jobType: record.jobType,
    status: record.status,
    progress: record.progress,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}
