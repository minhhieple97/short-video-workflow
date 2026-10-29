"use client";

import { Copy, Loader2, Save, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendJson } from "@/lib/api-client";

import {
  captionWithHashtags,
  formatHashtags,
  parseHashtagInput,
  publishMetadataSchema,
  PUBLISH_CAPTION_MAX,
  PUBLISH_HASHTAGS_MAX,
  PUBLISH_HASHTAGS_MIN,
  PUBLISH_TITLE_MAX,
} from "../../domain/publish-metadata";
import type { PublishMetadataDto } from "../../schemas/video.dto";
import { useVideoAction } from "../use-video-action";

interface PublishMetadataPanelProps {
  videoId: string;
  publish: PublishMetadataDto | null;
  hasScript: boolean;
  // A rewrite of the set is queued, running or waiting for Claude Code.
  busy: boolean;
  // A script job or an automatic production owns the script, and with it the set.
  locked: boolean;
}

function CopyButton({ text, label }: Readonly<{ text: string; label: string }>) {
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={text.trim().length === 0}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => toast.success("Đã sao chép."),
          () => toast.error("Trình duyệt không cho sao chép; hãy chọn chữ và sao chép tay."),
        )
      }
    >
      <Copy aria-hidden />
      {label}
    </Button>
  );
}

function GenerateButton({
  videoId,
  publish,
  disabled,
  busy,
}: Readonly<{ videoId: string; publish: PublishMetadataDto | null; disabled: boolean; busy: boolean }>) {
  const { pending, runJob } = useVideoAction();
  const working = pending || busy;
  const generate = () =>
    void runJob(
      () => sendJson<{ jobId: string }>(`/api/videos/${videoId}/publish-metadata/generate`, "POST"),
      "Đã viết tiêu đề, caption và hashtag mới.",
    );

  const button = (
    <Button
      variant={publish ? "outline" : "default"}
      disabled={disabled || working}
      onClick={publish?.origin === "EDITED" ? undefined : generate}
    >
      {working ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
      {working ? "Đang viết…" : publish ? "Tạo lại" : "Tạo tiêu đề & caption"}
    </Button>
  );
  if (publish?.origin !== "EDITED") return button;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Thay bản bạn đã sửa?</AlertDialogTitle>
          <AlertDialogDescription>
            Tiêu đề, caption và hashtag bạn đã sửa tay sẽ được thay bằng bản AI viết mới từ kịch bản hiện tại.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction onClick={generate}>Tạo lại</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// One title, caption and hashtag set for TikTok, Facebook Reels and YouTube Shorts: written by the AI with the script,
// rewritten on demand, editable and ready to copy. The page remounts it (key) whenever the stored set changes.
export function PublishMetadataPanel({
  videoId,
  publish,
  hasScript,
  busy,
  locked,
}: Readonly<PublishMetadataPanelProps>) {
  const { pending, run } = useVideoAction();
  const [title, setTitle] = useState(publish?.title ?? "");
  const [caption, setCaption] = useState(publish?.caption ?? "");
  const [hashtagText, setHashtagText] = useState(formatHashtags(publish?.hashtags ?? []));

  const hashtags = parseHashtagInput(hashtagText);
  const parsed = publishMetadataSchema.safeParse({ title, caption, hashtags });
  const dirty =
    publish !== null &&
    (title !== publish.title || caption !== publish.caption || hashtagText !== formatHashtags(publish.hashtags));
  const save = () =>
    void run(
      () => sendJson(`/api/videos/${videoId}/publish-metadata`, "PUT", { title, caption, hashtags }),
      "Đã lưu tiêu đề, caption và hashtag.",
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Tiêu đề, caption & hashtag
          {publish ? <Badge variant="slate">{publish.origin === "AI" ? "AI viết" : "Đã sửa tay"}</Badge> : null}
          {publish?.outdated ? <Badge variant="amber">Cần xem lại</Badge> : null}
        </CardTitle>
        <CardDescription>Một bộ dùng chung cho TikTok, Facebook Reels và YouTube Shorts.</CardDescription>
        <CardAction>
          <GenerateButton videoId={videoId} publish={publish} disabled={!hasScript || locked} busy={busy} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {publish === null ? (
          <EmptyState
            title={hasScript ? "Chưa có tiêu đề và caption" : "Chưa có kịch bản"}
            description={
              hasScript
                ? "Bấm “Tạo tiêu đề & caption” để AI viết từ kịch bản hiện tại."
                : "Tiêu đề, caption và hashtag được AI viết cùng kịch bản."
            }
          />
        ) : (
          <>
            {publish.outdated ? (
              <Alert>
                <AlertTitle>Kịch bản đã đổi sau khi viết bộ này</AlertTitle>
                <AlertDescription>
                  Hãy đọc lại và sửa cho khớp rồi bấm Lưu, hoặc bấm “Tạo lại” để AI viết theo kịch bản mới. Cho tới lúc
                  đó, bản render cuối không kèm publish.txt khi lưu lên Google Drive.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="publish-title">Tiêu đề</Label>
                <CopyButton text={title} label="Sao chép" />
              </div>
              <Input
                id="publish-title"
                value={title}
                maxLength={PUBLISH_TITLE_MAX}
                onChange={(event) => setTitle(event.target.value)}
              />
              <p className="text-muted-foreground text-xs tabular-nums">
                {title.length}/{PUBLISH_TITLE_MAX} ký tự · dùng làm tiêu đề YouTube Shorts
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="publish-caption">Caption</Label>
                <CopyButton text={caption} label="Sao chép" />
              </div>
              <Textarea
                id="publish-caption"
                value={caption}
                rows={7}
                maxLength={PUBLISH_CAPTION_MAX}
                onChange={(event) => setCaption(event.target.value)}
              />
              <p className="text-muted-foreground text-xs tabular-nums">
                {caption.length}/{PUBLISH_CAPTION_MAX} ký tự · dòng đầu hiện trước “xem thêm”
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="publish-hashtags">Hashtag</Label>
                <CopyButton text={formatHashtags(hashtags)} label="Sao chép" />
              </div>
              <Input
                id="publish-hashtags"
                value={hashtagText}
                onChange={(event) => setHashtagText(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {PUBLISH_HASHTAGS_MIN}–{PUBLISH_HASHTAGS_MAX} thẻ, cách nhau bằng dấu cách; khi lưu sẽ tự bỏ dấu và viết
                thường.
              </p>
            </div>
            {parsed.success ? null : (
              <p className="text-sm text-red-600 dark:text-red-400">{parsed.error.issues[0]?.message}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={!dirty || !parsed.success || pending || busy || locked}>
                <Save aria-hidden /> Lưu
              </Button>
              <CopyButton
                text={parsed.success ? captionWithHashtags(parsed.data) : ""}
                label="Sao chép caption + hashtag"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
