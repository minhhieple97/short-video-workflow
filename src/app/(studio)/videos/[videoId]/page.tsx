import { Clapperboard, Factory } from "lucide-react";
import Link from "next/link";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScriptSourcePanel } from "@/features/productions/components/script-source-panel";
import { ITEM_STATUS_LABELS, productionStep } from "@/features/productions/domain/production-labels";
import { getVideoProduction } from "@/features/productions/services/video-production.service";
import { ActiveJobWatcher } from "@/features/videos/components/active-job-watcher";
import { AddSceneControl } from "@/features/videos/components/add-scene-control";
import { DurationBudgetBar } from "@/features/videos/components/duration-budget-bar";
import { EditorWorkspace } from "@/features/videos/components/editor-workspace";
import { HookOptions } from "@/features/videos/components/hook-options";
import { VideoPreview } from "@/features/videos/components/preview/video-preview";
import { VoicePanel } from "@/features/videos/components/voice/voice-panel";
import { SceneEditorCard } from "@/features/videos/components/scene-editor-card";
import { ScriptLock } from "@/features/videos/components/script-lock";
import {
  ApproveScriptButton,
  DeleteVideoButton,
  GenerateScriptButton,
} from "@/features/videos/components/video-actions";
import { VideoSettingsDialog } from "@/features/videos/components/video-settings-dialog";
import { VideoStatusBadge } from "@/features/videos/components/video-status-badge";
import { toCompositionProps } from "@/features/videos/domain/composition-props";
import { formatPreset, HOOK_MAX_SECONDS } from "@/features/videos/domain/duration";
import { toPlatformPreviewMode } from "@/features/videos/domain/safe-zones";
import { mediaAssetUrl } from "@/features/videos/services/video-mapper";
import { findActiveVideoJob, getVideo } from "@/features/videos/services/video.service";
import { getAppConfig } from "@/shared/config/env";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

const TABS = ["hook", "story", "voice", "sources", "preview"] as const;
const SCRIPT_LOCKED_NOTE =
  "Trong lúc này cài đặt, hook, kịch bản, giọng đọc, render và xoá video tạm khoá, vì nội dung kịch bản sắp được thay mới.";

interface VideoEditorPageProps {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function VideoEditorPage({ params, searchParams }: Readonly<VideoEditorPageProps>) {
  const [{ videoId }, { tab }] = await Promise.all([params, searchParams]);
  const video = await orNotFound(getVideo(videoId));
  const [activeJob, production] = await Promise.all([findActiveVideoJob(videoId), getVideoProduction(videoId)]);
  const inProduction = production?.inProgress === true;
  const locked = activeJob !== null || inProduction;
  const busyLabel = activeJob
    ? activeJob.sceneNumber === null
      ? "Đang tạo kịch bản…"
      : `Đang viết lại cảnh ${activeJob.sceneNumber}…`
    : null;
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
            <Badge variant="orange">
              {video.extended
                ? `Video dài ${formatPreset(video.targetDurationSec)}`
                : `Short ${video.targetDurationSec}s`}
            </Badge>
            <span>Kịch bản v{video.scriptVersion}</span>
          </div>
        }
        actions={
          <>
            <GenerateScriptButton video={video} busyLabel={busyLabel} locked={inProduction} />
            <ApproveScriptButton video={video} locked={locked} />
            <VideoSettingsDialog video={video} locked={locked} maxDurationSec={getAppConfig().video.maxDurationSec} />
            {locked ? (
              <Button variant="outline" disabled>
                <Clapperboard aria-hidden />
                Render
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={`/videos/${video.id}/render`}>
                  <Clapperboard aria-hidden />
                  Render
                </Link>
              </Button>
            )}
            <DeleteVideoButton videoId={video.id} bookId={video.book.id} locked={locked} />
          </>
        }
      />

      {activeJob ? (
        <ActiveJobWatcher job={activeJob.job} sceneNumber={activeJob.sceneNumber} lockedNote={SCRIPT_LOCKED_NOTE} />
      ) : null}

      {production ? (
        <Alert>
          <Factory aria-hidden />
          <AlertTitle>
            {inProduction
              ? `Đang sản xuất tự động · ${ITEM_STATUS_LABELS[production.status].label} · tiếp theo: ${productionStep(production.checkpoint).label}`
              : `Video của một đợt sản xuất · ${ITEM_STATUS_LABELS[production.status].label}`}
          </AlertTitle>
          <AlertDescription>
            {inProduction
              ? "Kịch bản, giọng đọc, render và xoá video tạm khoá cho tới khi đợt sản xuất xong hoặc bị huỷ."
              : "Kịch bản được viết theo bản thảo ở tab Nguồn kịch bản và được máy kiểm tra sau khi lồng tiếng."}{" "}
            {production.correction ? `${production.correction}. ` : null}
            <Link href={`/productions/${production.productionId}`} className="font-medium underline underline-offset-4">
              Xem tiến độ sản xuất
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <DurationBudgetBar
          budget={video.budget}
          withAudio={video.scenes.filter((scene) => !scene.hidden).every((scene) => scene.audio !== null)}
        />
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hook {HOOK_MAX_SECONDS} giây đầu</span>
          {video.scenes.length === 0 ? (
            <span className="text-muted-foreground">Chưa có kịch bản.</span>
          ) : video.hookIssues.length === 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              Đạt — HOOK bắt đầu tại frame 0, đọc xong trong {HOOK_MAX_SECONDS} giây.
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

      <EditorWorkspace
        active={active}
        preview={
          <VideoPreview
            videoId={video.id}
            props={video.scenes.some((scene) => !scene.hidden) ? toCompositionProps(video, mediaAssetUrl) : null}
            initialMode={toPlatformPreviewMode(video.platformPreviewMode)}
          />
        }
        tabs={[
          {
            value: "hook",
            label: "Hook",
            content: (
              <ScriptLock locked={locked}>
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
              </ScriptLock>
            ),
          },
          {
            value: "story",
            label: `Kịch bản (${video.scenes.length} cảnh)`,
            content:
              video.scenes.length === 0 ? (
                <EmptyState title="Chưa có kịch bản" description="Bấm “Tạo kịch bản” để AI đề xuất hook và các cảnh." />
              ) : (
                <ScriptLock locked={locked}>
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
                </ScriptLock>
              ),
          },
          ...(production
            ? [{ value: "sources", label: "Nguồn kịch bản", content: <ScriptSourcePanel production={production} /> }]
            : []),
          {
            value: "voice",
            label: "Giọng đọc",
            content: (
              <ScriptLock locked={locked}>
                <VoicePanel
                  videoId={video.id}
                  scenes={video.scenes}
                  tts={{
                    mode: getAppConfig().tts.mode,
                    voice: getAppConfig().tts.voice,
                    speed: getAppConfig().tts.speed,
                  }}
                />
              </ScriptLock>
            ),
          },
        ]}
      />
    </section>
  );
}
