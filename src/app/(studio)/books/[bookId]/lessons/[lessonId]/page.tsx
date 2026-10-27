import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LessonOriginBadge, LessonStatusBadge } from "@/features/lessons/components/lesson-badges";
import { LessonEditor } from "@/features/lessons/components/lesson-editor";
import { LessonSources } from "@/features/lessons/components/lesson-sources";
import { LessonStatusActions } from "@/features/lessons/components/lesson-status-actions";
import { MergeLessonDialog } from "@/features/lessons/components/merge-lesson-dialog";
import { pickLessonText } from "@/features/lessons/domain/lesson-fields";
import { getLesson, listLessons } from "@/features/lessons/services/lesson.service";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: Readonly<{ params: Promise<{ bookId: string; lessonId: string }> }>) {
  const { bookId, lessonId } = await params;
  const lesson = await orNotFound(getLesson(lessonId));
  if (lesson.book.id !== bookId) notFound();

  const candidates = (await listLessons(bookId))
    .filter((other) => other.id !== lesson.id && other.status !== "ARCHIVED")
    .map(({ id, title }) => ({ id, title }));
  const mergeBlocked =
    lesson.status === "ARCHIVED"
      ? "Bài học đã lưu trữ."
      : lesson.videos.length > 0
        ? "Bài học đang được dùng trong video."
        : null;

  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Sách", href: "/books" },
          { label: lesson.book.title, href: `/books/${bookId}?tab=lessons` },
          { label: "Bài học" },
        ]}
      />
      <PageHeader
        title={lesson.title}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <LessonStatusBadge status={lesson.status} />
            <LessonOriginBadge origin={lesson.origin} />
            <span>
              Cập nhật {formatDateTime(lesson.updatedAt)}
              {lesson.analysisPromptVersion ? ` · ${lesson.analysisPromptVersion}` : ""}
            </span>
          </div>
        }
        actions={
          <>
            <LessonStatusActions lessonId={lesson.id} status={lesson.status} />
            <MergeLessonDialog
              lessonId={lesson.id}
              bookId={bookId}
              candidates={candidates}
              disabledReason={mergeBlocked}
            />
          </>
        }
      />

      {lesson.origin === "AI" ? (
        <Alert>
          <AlertDescription>
            Tình huống minh họa do AI sáng tác để giải thích bài học, không phải câu chuyện có thật trong sách. Hãy đối
            chiếu với trích đoạn nguồn trước khi duyệt.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nội dung bài học</CardTitle>
          </CardHeader>
          <CardContent>
            <LessonEditor key={lesson.updatedAt} lessonId={lesson.id} initial={pickLessonText(lesson)} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nguồn trong sách</CardTitle>
            </CardHeader>
            <CardContent>
              <LessonSources bookId={bookId} sources={lesson.sources} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Đã dùng trong {lesson.videos.length} video</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {lesson.videos.length === 0 ? (
                <p className="text-muted-foreground">Chưa được dùng. Chỉ bài học đã duyệt mới dùng để tạo video.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {lesson.videos.map((video) => (
                    <li key={video.id}>
                      <Link href={`/videos/${video.id}`} className="hover:underline">
                        {video.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
