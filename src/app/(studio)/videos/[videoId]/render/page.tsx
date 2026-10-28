import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActiveJobWatcher } from "@/features/videos/components/active-job-watcher";
import { PreflightList } from "@/features/videos/components/render/preflight-list";
import { RenderButtons } from "@/features/videos/components/render/render-buttons";
import { RenderHistory } from "@/features/videos/components/render/render-history";
import { dimensionsFor, listRenders, preflightFor } from "@/features/videos/services/render.service";
import { findActiveVideoJob, getVideo } from "@/features/videos/services/video.service";
import { orNotFound } from "@/server/http/page-helpers";
import { getAppConfig } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export default async function VideoRenderPage({ params }: Readonly<{ params: Promise<{ videoId: string }> }>) {
  const { videoId } = await params;
  const video = await orNotFound(getVideo(videoId));
  const [renders, activeJob] = await Promise.all([listRenders(videoId), findActiveVideoJob(videoId)]);
  const locked = activeJob !== null;
  const draft = preflightFor(video, "DRAFT");
  const final = preflightFor(video, "FINAL");
  const latest = renders.find((render) => render.status === "COMPLETED");
  const label = (quality: "DRAFT" | "FINAL") => {
    const dims = dimensionsFor(quality);
    return `${dims.width}×${dims.height}`;
  };

  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Video", href: "/videos" },
          { label: video.title, href: `/videos/${video.id}` },
          { label: "Render" },
        ]}
      />
      <PageHeader
        title="Render MP4"
        description={`9:16 · 30 FPS · H.264 + AAC · preset ${video.targetDurationSec}s · render concurrency ${getAppConfig().concurrency.render}`}
      />

      {activeJob ? (
        <ActiveJobWatcher
          job={activeJob.job}
          sceneNumber={activeJob.sceneNumber}
          lockedNote="Chưa thể render cho tới khi kịch bản được cập nhật xong (hoặc tác vụ bị huỷ)."
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kiểm tra trước khi render</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <PreflightList title={`Nháp ${label("DRAFT")}`} report={draft} />
            <PreflightList title={`Bản cuối ${label("FINAL")}`} report={final} />
          </div>
          <RenderButtons
            videoId={video.id}
            blocked={{ DRAFT: locked || draft.blocking.length > 0, FINAL: locked || final.blocking.length > 0 }}
            dims={{ DRAFT: label("DRAFT"), FINAL: label("FINAL") }}
          />
        </CardContent>
      </Card>

      {latest?.outdated ? (
        <Alert>
          <AlertDescription>
            Bản render mới nhất được tạo từ kịch bản v{latest.scriptVersion}; kịch bản hiện tại là v
            {video.scriptVersion}. Hãy render lại để cập nhật.
          </AlertDescription>
        </Alert>
      ) : null}

      {latest?.fileUrl ? (
        <video
          key={latest.id}
          src={latest.fileUrl}
          controls
          className="mx-auto aspect-[9/16] w-72 rounded-2xl bg-black"
          aria-label="Bản render mới nhất"
        />
      ) : null}

      <RenderHistory renders={renders} />
    </section>
  );
}
