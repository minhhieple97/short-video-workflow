import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { getVideoDriveLinks } from "@/features/archive/services/archive-control.service";
import { VideoTable } from "@/features/videos/components/video-table";
import { VIDEO_PAGE_SIZE } from "@/features/videos/domain/paging";
import { listVideosPage } from "@/features/videos/services/video.service";
import { toPageRequest } from "@/shared/pagination";

export const dynamic = "force-dynamic";

export default async function VideosPage({ searchParams }: Readonly<{ searchParams: Promise<{ page?: string }> }>) {
  const { page } = await searchParams;
  const videos = await listVideosPage({}, toPageRequest(page, VIDEO_PAGE_SIZE));
  const drives = await getVideoDriveLinks(videos.items.map((video) => video.id));
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Video" description="Video ngắn dọc 9:16 tạo từ bài học đã duyệt." />
      <VideoTable
        videos={videos.items}
        drives={drives}
        showBook
        emptyHint="Mở một cuốn sách, duyệt bài học rồi chọn “Tạo video” ở tab Video."
      />
      <Pagination page={videos} />
    </section>
  );
}
