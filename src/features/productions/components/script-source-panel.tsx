import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { NARRATIVE_BEAT_LABELS } from "@/features/videos/domain/narrative-beats";

import type { VideoProductionDto } from "../schemas/video-production.dto";
import type { ScriptSourceViewDto } from "@/features/videos/schemas/script-source-view.dto";

const actualNote = (model: string | null): string => (model ? ` (model thực tế: ${model})` : "");

// The draft the script studio wrote before Claude edited it into scenes: each beat's narration, the book passages it rests
// on, and whether it is a scenario invented to illustrate the lesson.
export function ScriptSourcePanel({
  production,
  source,
}: Readonly<{ production?: VideoProductionDto; source?: ScriptSourceViewDto }>) {
  const draft = source?.draft ?? production?.draft;
  if (!draft) {
    return (
      <EmptyState
        title="Chưa có bản thảo"
        description="Bản thảo xuất hiện khi bước viết bản thảo của đợt sản xuất xong."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {source ? (
        <>
          <p className="text-muted-foreground text-sm">
            Chế độ: {source.generation.mode === "mock" ? "dữ liệu mẫu, không gọi model thật" : source.generation.mode}.{" "}
            Bản thảo: {source.generation.script.model} · effort {source.generation.script.effort}
            {actualNote(source.actualModels.script)}. Lập cảnh: {source.generation.scene.model} · effort{" "}
            {source.generation.scene.effort}
            {actualNote(source.actualModels.scene)}. Model và effort là cấu hình yêu cầu của lần tạo; model thực tế chỉ
            hiện khi Claude Code báo về. Tình huống minh họa được đánh dấu.
          </p>
          {source.edited ? (
            <p className="text-muted-foreground text-sm">
              Kịch bản đã được chỉnh sửa sau lần tạo này. Phần dưới là bản thảo AI đã viết trước các chỉnh sửa.
            </p>
          ) : null}
          <div className="bg-card space-y-3 rounded-2xl border p-4">
            <h3 className="font-semibold">Nhân vật của video</h3>
            <ul className="space-y-1 text-sm">
              {source.cast.profiles.map((profile) => (
                <li key={profile.id}>
                  <strong>{profile.name}</strong> · {profile.gender === "MALE" ? "Nam" : "Nữ"} · xưng “{profile.pronoun}
                  ” · {profile.role}
                  {profile.id === source.cast.primaryCharacterId ? " · Nhân vật chính" : ""}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-card space-y-3 rounded-2xl border p-4">
            <h3 className="font-semibold">Logic câu chuyện</h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium">Câu hỏi trung tâm</dt>
                <dd>{source.logic.question}</dd>
              </div>
              <div>
                <dt className="font-medium">Vì sao cách cũ có vẻ hợp lý?</dt>
                <dd>{source.logic.oldChoiceMotive}</dd>
              </div>
              <div>
                <dt className="font-medium">Cơ chế của nguyên lý</dt>
                <dd>{source.logic.mechanism}</dd>
              </div>
              <div>
                <dt className="font-medium">Hành động thay đổi</dt>
                <dd>{source.logic.changedActions.join(" → ")}</dd>
              </div>
              <div>
                <dt className="font-medium">Kết quả quan sát được</dt>
                <dd>{source.logic.observableResult}</dd>
              </div>
              <div>
                <dt className="font-medium">Điều kiện và giới hạn</dt>
                <dd>{source.logic.limits}</dd>
              </div>
            </dl>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          {production?.generationModels
            ? `Bản thảo do ${production.generationModels.script.model} viết; ${production.generationModels.scene.model} lập cảnh`
            : "Bản thảo từ bộ viết kịch bản (NotebookLM), được Claude biên tập thành cảnh"}
          {production?.scenePlanVersion ? ` (${production.scenePlanVersion})` : ""}. Câu trích dẫn chỉ lấy từ trích đoạn
          sách bên dưới; tình huống minh hoạ được đánh dấu.
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {draft.map((beat, index) => (
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
                    <span className="font-medium">
                      {source.page === null ? "Chưa xác định trang" : `Trang ${source.page}`}:{" "}
                    </span>
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
