import type { JobRecord } from "@/generated/prisma/client";
import { aiRunCommand, isJobType, type JobListItem } from "@/shared/types/job";

import { findJobEntities } from "../repositories/job-entity.repository";
import { listActiveJobRecords, listJobRecords } from "../repositories/job-record.repository";
import { toJobDto } from "./job-dto";

interface EntityRef {
  label: string;
  href: string | null;
}

const RETRYABLE = new Set(["FAILED", "CANCELLED"]);
const CANCELLABLE = new Set(["QUEUED", "RUNNING", "WAITING_FOR_CLI"]);

// Resolves entity names in six batched queries instead of one query per job row.
async function resolveEntities(records: readonly JobRecord[]): Promise<Map<string, EntityRef>> {
  const idsOf = (type: string) =>
    records.filter((record) => record.entityType === type).map((record) => record.entityId);
  const { chapters, videos, scenes, renders, productionItems, archives } = await findJobEntities({
    chapterIds: idsOf("CHAPTER"),
    videoIds: idsOf("VIDEO"),
    sceneIds: idsOf("SCENE"),
    renderIds: idsOf("RENDER"),
    productionItemIds: idsOf("PRODUCTION_ITEM"),
    archiveIds: idsOf("ARCHIVE"),
  });

  const refs = new Map<string, EntityRef>();
  for (const chapter of chapters) {
    refs.set(`CHAPTER:${chapter.id}`, {
      label: chapter.title,
      href: `/books/${chapter.bookId}/chapters/${chapter.id}`,
    });
  }
  for (const video of videos) refs.set(`VIDEO:${video.id}`, { label: video.title, href: `/videos/${video.id}` });
  for (const scene of scenes) {
    refs.set(`SCENE:${scene.id}`, {
      label: `Cảnh ${scene.order + 1} · ${scene.video.title}`,
      href: `/videos/${scene.videoId}?tab=story`,
    });
  }
  for (const render of renders) {
    refs.set(`RENDER:${render.id}`, {
      label: `${render.qualityPreset === "FINAL" ? "Bản cuối" : "Nháp"} · ${render.video.title}`,
      href: `/videos/${render.videoId}/render`,
    });
  }
  for (const item of productionItems) {
    refs.set(`PRODUCTION_ITEM:${item.id}`, {
      label: `Sản xuất · ${item.lesson.title}`,
      href: item.videoId ? `/videos/${item.videoId}` : null,
    });
  }
  for (const archive of archives) {
    refs.set(`ARCHIVE:${archive.id}`, {
      label: `Lưu Drive · ${archive.render.video.title}`,
      href: `/videos/${archive.render.videoId}/render`,
    });
  }
  return refs;
}

export async function listJobsForDashboard(limit = 100): Promise<JobListItem[]> {
  return toJobListItems(await listJobRecords(limit));
}

export async function listActiveJobs(): Promise<JobListItem[]> {
  return toJobListItems(await listActiveJobRecords());
}

async function toJobListItems(records: readonly JobRecord[]): Promise<JobListItem[]> {
  const refs = await resolveEntities(records);
  return records.map((record) => {
    const ref = refs.get(`${record.entityType}:${record.entityId}`);
    return {
      ...toJobDto(record),
      entityLabel: ref?.label ?? (record.entityType === "SYSTEM" ? "Hệ thống" : "Đã xoá"),
      entityHref: ref?.href ?? null,
      attempts: record.attempts,
      cliCommand: record.status === "WAITING_FOR_CLI" ? aiRunCommand(record.id) : null,
      canRetry:
        RETRYABLE.has(record.status) &&
        isJobType(record.jobType) &&
        (record.entityType === "SYSTEM" || ref !== undefined),
      canCancel: CANCELLABLE.has(record.status),
    };
  });
}
