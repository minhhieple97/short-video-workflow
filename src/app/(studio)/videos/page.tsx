import { PageHeader } from "@/components/layout/page-header";
import { VideoTable } from "@/features/videos/components/video-table";
import { listVideos } from "@/features/videos/services/video.service";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const videos = await listVideos();
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Video" description="Video ngắn dọc 9:16 tạo từ bài học đã duyệt." />
      <VideoTable
        videos={videos}
        showBook
        emptyHint="Mở một cuốn sách, duyệt bài học rồi chọn “Tạo video” ở tab Video."
      />
    </section>
  );
}
