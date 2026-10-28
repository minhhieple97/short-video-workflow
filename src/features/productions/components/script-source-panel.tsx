import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { NARRATIVE_BEAT_LABELS } from "@/features/videos/domain/narrative-beats";

import type { VideoProductionDto } from "../schemas/video-production.dto";

// The draft the script studio wrote before Claude edited it into scenes: each beat's narration, the book passages it rests
// on, and whether it is a scenario invented to illustrate the lesson.
export function ScriptSourcePanel({ production }: Readonly<{ production: VideoProductionDto }>) {
  if (!production.draft) {
    return (
      <EmptyState
        title="Chưa có bản thảo"
        description="Bản thảo xuất hiện khi bước viết bản thảo của đợt sản xuất xong."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Bản thảo từ bộ viết kịch bản (NotebookLM), được Claude biên tập thành cảnh
        {production.scenePlanVersion ? ` (${production.scenePlanVersion})` : ""}. Câu trích dẫn chỉ lấy từ trích đoạn
        sách bên dưới; tình huống minh hoạ được đánh dấu.
      </p>
      <ol className="flex flex-col gap-3">
        {production.draft.map((beat, index) => (
          <li key={`${beat.beat}-${index}`} className="bg-card shadow-card flex flex-col gap-2 rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{NARRATIVE_BEAT_LABELS[beat.beat]}</span>
              {beat.illustrative ? <Badge variant="blue">Tình huống minh hoạ</Badge> : null}
              {beat.sources.length === 0 && !beat.illustrative ? <Badge variant="slate">Không trích sách</Badge> : null}
            </div>
            <p className="text-sm">{beat.narration}</p>
            {beat.sources.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {beat.sources.map((source, sourceIndex) => (
                  <li key={sourceIndex} className="border-border text-muted-foreground border-l-2 pl-3 text-sm">
                    <span className="font-medium">Trang {source.page}: </span>
                    <q>{source.text}</q>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
