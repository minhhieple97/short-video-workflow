import { BookOpen, Clapperboard, Clock, ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/layout/stat-tile";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/features/books/components/book-card";
import { oauthCallbackLocation } from "@/features/drive/domain/oauth-callback";
import { listBooks } from "@/features/books/services/book.service";
import { JobTable } from "@/features/jobs/components/job-table";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import { listActiveJobs } from "@/features/jobs/services/job-dashboard.service";
import { VideoCard } from "@/features/videos/components/video-card";
import { listVideos } from "@/features/videos/services/video.service";

export const dynamic = "force-dynamic";

const RECENT_BOOK_COUNT = 4;
const RECENT_VIDEO_COUNT = 4;

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: Readonly<DashboardPageProps>) {
  const callback = oauthCallbackLocation(await searchParams);
  if (callback) redirect(callback);

  const [allBooks, allVideos, activeJobs] = await Promise.all([listBooks(), listVideos(), listActiveJobs()]);
  const books = allBooks.slice(0, RECENT_BOOK_COUNT);
  const videos = allVideos.slice(0, RECENT_VIDEO_COUNT);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title="Tổng quan"
        description={
          <>
            Tác vụ đang chạy, sách và video gần đây. Kiểm tra hệ thống tại{" "}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              Cài đặt
            </Link>
            .
          </>
        }
        actions={
          <Button asChild>
            <Link href="/books/import">
              <Plus aria-hidden />
              Nhập sách
            </Link>
          </Button>
        }
      />

      <section aria-label="Số liệu nhanh" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile label="Sách" value={allBooks.length} icon={BookOpen} tone="violet" />
        <StatTile label="Video" value={allVideos.length} icon={Clapperboard} tone="orange" />
        <StatTile
          label="Cần duyệt"
          value={allVideos.filter((video) => video.status === "NEEDS_REVIEW").length}
          icon={Clock}
          tone="amber"
        />
        <StatTile label="Tác vụ đang chạy" value={activeJobs.length} icon={ListChecks} tone="mint" />
      </section>

      <section
        aria-labelledby="jobs-title"
        className="bg-card shadow-card ring-border overflow-hidden rounded-2xl ring-1"
      >
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 id="jobs-title" className="text-lg font-bold">
            Tác vụ đang chạy
          </h2>
          <Link href="/jobs" className="text-primary text-sm font-semibold hover:underline">
            Xem tất cả →
          </Link>
        </div>
        <JobsAutoRefresh active={activeJobs.length > 0} />
        {activeJobs.length === 0 ? (
          <p className="text-muted-foreground px-6 py-5 text-sm">Không có tác vụ nào đang chờ hoặc đang chạy.</p>
        ) : (
          <div className="px-2 py-1">
            <JobTable jobs={activeJobs} />
          </div>
        )}
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-labelledby="videos-title" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 id="videos-title" className="text-lg font-bold">
              Video gần đây
            </h2>
            <Link href="/videos" className="text-primary text-sm font-semibold hover:underline">
              Xem tất cả →
            </Link>
          </div>
          {videos.length === 0 ? (
            <EmptyState title="Chưa có video" description="Duyệt bài học trong một cuốn sách rồi tạo video." />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-5">
              {videos.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="books-title" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 id="books-title" className="text-lg font-bold">
              Sách gần đây
            </h2>
            <Link href="/books" className="text-primary text-sm font-semibold hover:underline">
              Xem tất cả →
            </Link>
          </div>
          {books.length === 0 ? (
            <EmptyState title="Chưa có sách nào" description="Nhập tệp .md hoặc .txt để bắt đầu." />
          ) : (
            <div className="flex flex-col gap-3">
              {books.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
