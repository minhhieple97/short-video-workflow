import Link from "next/link";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { UrlTabs } from "@/components/layout/url-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActiveJobWatcher } from "@/features/videos/components/active-job-watcher";
import { AddSceneControl } from "@/features/videos/components/add-scene-control";
import { DurationBudgetBar } from "@/features/videos/components/duration-budget-bar";
import { HookOptions } from "@/features/videos/components/hook-options";
import { SceneEditorCard } from "@/features/videos/components/scene-editor-card";
import {
  ApproveScriptButton,
  DeleteVideoButton,
  GenerateScriptButton,
} from "@/features/videos/components/video-actions";
import { VideoSettingsDialog } from "@/features/videos/components/video-settings-dialog";
import { VideoStatusBadge } from "@/features/videos/components/video-status-badge";
import { findActiveVideoJob, getVideo } from "@/features/videos/services/video.service";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

const TABS = ["hook", "story", "voice", "preview"] as const;

interface VideoEditorPageProps {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function VideoEditorPage({ params, searchParams }: Readonly<VideoEditorPageProps>) {
  const [{ videoId }, { tab }] = await Promise.all([params, searchParams]);
  const video = await orNotFound(getVideo(videoId));
  const activeJob = await findActiveVideoJob(videoId);
  const hookScene = video.scenes.find((scene) => scene.type === "HOOK");
  const sceneIds = video.scenes.map((scene) => scene.id);
  const active = TABS.find((value) => value === tab) ?? "hook";

  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Video", href: "/videos" },
          { label: video.book.title, href: `/books/${video.book.id}?tab=videos` },
          { label: video.title },
        ]}
      />
      <PageHeader
        title={video.title}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <VideoStatusBadge status={video.status} />
            <Badge variant="outline">
              9:16 · {video.width}×{video.height} · {video.fps} FPS
            </Badge>
            <Badge variant={video.extended ? "secondary" : "outline"}>
              {video.extended ? "Extended Short 90s" : `Short ${video.targetDurationSec}s`}
            </Badge>
            <span>Kịch bản v{video.scriptVersion}</span>
          </div>
        }
        actions={
          <>
            <GenerateScriptButton video={video} />
            <ApproveScriptButton video={video} />
            <VideoSettingsDialog video={video} />
            <DeleteVideoButton videoId={video.id} bookId={video.book.id} />
          </>
        }
      />

      {activeJob ? <ActiveJobWatcher jobId={activeJob.id} label="Worker đang tạo kịch bản…" /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <DurationBudgetBar budget={video.budget} />
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hook 3 giây đầu</span>
          {video.scenes.length === 0 ? (
            <span className="text-muted-foreground">Chưa có kịch bản.</span>
          ) : video.hookIssues.length === 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              Đạt — HOOK bắt đầu tại frame 0, đọc xong trong 3 giây.
            </span>
          ) : (
            <ul className="text-red-600 dark:text-red-400">
              {video.hookIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="text-sm">
        <span className="font-medium">Bài học nguồn: </span>
        {video.lessons.map((lesson, index) => (
          <span key={lesson.lessonId}>
            {index > 0 ? " · " : ""}
            <Link href={`/books/${video.book.id}/lessons/${lesson.lessonId}`} className="hover:underline">
              {lesson.title}
            </Link>
            {lesson.changedSinceSnapshot ? (
              <span className="text-muted-foreground"> (đã sửa sau khi tạo video)</span>
            ) : null}
          </span>
        ))}
      </div>

      {video.status === "NEEDS_REVIEW" && video.approvedScriptVersion !== null ? (
        <Alert>
          <AlertTitle>Kịch bản đã thay đổi sau khi duyệt</AlertTitle>
          <AlertDescription>Hãy kiểm tra lại và duyệt lần nữa trước khi tạo giọng đọc hoặc render.</AlertDescription>
        </Alert>
      ) : null}

      <UrlTabs
        active={active}
        tabs={[
          {
            value: "hook",
            label: "Hook",
            content: (
              <div className="flex flex-col gap-4">
                <HookOptions videoId={video.id} options={video.hookOptions} hookScene={hookScene} />
                {hookScene ? (
                  <SceneEditorCard
                    key={`${hookScene.id}-${hookScene.version}`}
                    videoId={video.id}
                    scene={hookScene}
                    sceneIds={sceneIds}
                  />
                ) : null}
              </div>
            ),
          },
          {
            value: "story",
            label: `Kịch bản (${video.scenes.length} cảnh)`,
            content:
              video.scenes.length === 0 ? (
                <EmptyState title="Chưa có kịch bản" description="Bấm “Tạo kịch bản” để AI đề xuất hook và các cảnh." />
              ) : (
                <div className="flex flex-col gap-3">
                  {video.scenes.map((scene) => (
                    <SceneEditorCard
                      key={`${scene.id}-${scene.version}-${scene.order}`}
                      videoId={video.id}
                      scene={scene}
                      sceneIds={sceneIds}
                    />
                  ))}
                  <AddSceneControl videoId={video.id} />
                </div>
              ),
          },
          {
            value: "voice",
            label: "Giọng đọc",
            content: (
              <EmptyState
                title="Giọng đọc tiếng Việt"
                description="Tạo bằng edge-tts hoặc tải lên MP3/WAV cho từng cảnh (M5)."
              />
            ),
          },
          {
            value: "preview",
            label: "Xem trước",
            content: (
              <EmptyState
                title="Xem trước 9:16"
                description="Trình xem dạng điện thoại với vùng an toàn TikTok/Shorts/Reels (M4)."
              />
            ),
          },
        ]}
      />
    </section>
  );
}
