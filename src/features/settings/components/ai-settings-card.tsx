"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, sendJson } from "@/lib/api-client";

import { AI_EFFORTS, aiSettingsSchema, type AiSettings } from "../domain/ai-settings";
import type { AiSettingsDto } from "../schemas/ai-settings.dto";
import { CharacterSettingsCard } from "./character-settings-card";

export function AiSettingsCard({ overview }: Readonly<{ overview: AiSettingsDto }>) {
  const router = useRouter();
  const [saved, setSaved] = useState(overview);
  const [draft, setDraft] = useState<AiSettings>(overview.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validation = aiSettingsSchema.safeParse(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved.settings);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!validation.success) return;
    setSaving(true);
    setError(null);
    try {
      const result = await sendJson<AiSettingsDto>("/api/settings/ai", "PUT", {
        revision: saved.revision,
        settings: validation.data,
      });
      setSaved(result);
      setDraft(result.settings);
      toast.success("Đã lưu AI và nhân vật cho các yêu cầu mới.");
      router.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <fieldset disabled={saving} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI theo công đoạn</CardTitle>
            <CardDescription>
              Cấu hình áp dụng cho yêu cầu mới. Tác vụ đang chạy và video đã có giữ cấu hình của chúng. AI dùng Claude
              Code đã đăng nhập trên máy.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            {(
              [
                ["script", "Viết kịch bản · viết lại lời cảnh"],
                ["scene", "Lập cảnh, shot · thông tin đăng tải"],
              ] as const
            ).map(([stage, label]) => (
              <div key={stage} className="space-y-3 rounded-lg border p-4">
                <p className="font-medium">{label}</p>
                <div className="space-y-1">
                  <Label htmlFor={`ai-model-${stage}`}>Model</Label>
                  <Input
                    id={`ai-model-${stage}`}
                    value={draft[stage].model}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [stage]: { ...current[stage], model: event.target.value } }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`ai-effort-${stage}`}>Effort</Label>
                  <select
                    id={`ai-effort-${stage}`}
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    value={draft[stage].effort}
                    onChange={(event) => {
                      const effort = AI_EFFORTS.find((item) => item === event.target.value);
                      if (effort) setDraft((current) => ({ ...current, [stage]: { ...current[stage], effort } }));
                    }}
                  >
                    {AI_EFFORTS.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <CharacterSettingsCard
          value={draft.characters}
          onChange={(characters) => setDraft((current) => ({ ...current, characters }))}
        />
        {!validation.success ? (
          <p role="alert" className="text-destructive text-sm">
            {validation.error.issues.map((issue) => issue.message).join(" ")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!changed || !validation.success || saving}>
            {saving ? "Đang lưu…" : "Lưu AI và nhân vật"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
