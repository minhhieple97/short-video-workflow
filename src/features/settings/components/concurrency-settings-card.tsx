"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, sendJson } from "@/lib/api-client";

import {
  CONCURRENCY_KEYS,
  CONCURRENCY_SETTINGS,
  MIN_CONCURRENCY,
  isConcurrencyValue,
  type ConcurrencyKey,
  type ConcurrencySettings,
} from "../domain/concurrency-settings";
import type { ConcurrencySettingsDto, WorkerAvailability } from "../schemas/concurrency-settings.dto";
import { concurrencySettingsSchema } from "../schemas/concurrency-settings.schema";

const WORKER_NOTE: Record<WorkerAvailability, string> = {
  running:
    "Worker đang chạy: số mới có hiệu lực trong khoảng 5 giây, không cần khởi động lại. Loại việc nào đang chạy đủ số cũ thì nhận thêm việc khi một việc đang chạy xong; giảm số thì việc đang chạy vẫn chạy xong.",
  stopped: "Worker chưa chạy: số đã lưu được dùng khi worker khởi động.",
  unknown: "Không đọc được trạng thái worker (Redis chưa chạy?). Số đã lưu được dùng khi worker chạy.",
};

type Drafts = Record<ConcurrencyKey, string>;

function toDrafts(settings: ConcurrencySettings): Drafts {
  return {
    claude: String(settings.claude),
    notebooklm: String(settings.notebooklm),
    voice: String(settings.voice),
    render: String(settings.render),
    renderThreads: String(settings.renderThreads),
    archive: String(settings.archive),
    extraction: String(settings.extraction),
  };
}

// A draft that is a whole number in range, else null.
function parsed(key: ConcurrencyKey, draft: string): number | null {
  const value = Number(draft);
  return draft.trim() !== "" && isConcurrencyValue(key, value) ? value : null;
}

// The same rules the server applies, so Save is offered only for numbers it will take.
function toSettings(drafts: Drafts): ConcurrencySettings | null {
  const result = concurrencySettingsSchema.safeParse(
    Object.fromEntries(
      CONCURRENCY_KEYS.map((key) => [key, drafts[key].trim() === "" ? Number.NaN : Number(drafts[key])]),
    ),
  );
  return result.success ? result.data : null;
}

// How many tasks of each kind the worker runs at once. Saved in the database, so a stronger machine only needs new numbers.
export function ConcurrencySettingsCard({ overview }: Readonly<{ overview: ConcurrencySettingsDto }>) {
  const router = useRouter();
  const [saved, setSaved] = useState(overview.settings);
  const [drafts, setDrafts] = useState(() => toDrafts(overview.settings));
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const next = toSettings(drafts);
  const changed = next !== null && CONCURRENCY_KEYS.some((key) => next[key] !== saved[key]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!next) return;
    setSaving(true);
    try {
      const result = await sendJson<ConcurrencySettingsDto>("/api/settings/concurrency", "PUT", next);
      setSaved(result.settings);
      setDrafts(toDrafts(result.settings));
      toast.success("Đã lưu số việc chạy cùng lúc.");
      startRefresh(() => router.refresh());
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chạy song song</CardTitle>
        <CardDescription>
          Số việc mỗi loại được chạy cùng lúc. Mỗi loại có hàng đợi riêng, nên lưu Drive hay NotebookLM không phải chờ
          render xong. Tăng dần và theo dõi máy: tăng quá sức thì việc chậm hoặc lỗi hơn.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{WORKER_NOTE[overview.worker]}</p>
          <ul className="divide-border flex flex-col divide-y">
            {CONCURRENCY_KEYS.map((key) => {
              const setting = CONCURRENCY_SETTINGS[key];
              const invalid = parsed(key, drafts[key]) === null;
              const inputId = `concurrency-${key}`;
              return (
                <li key={key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label htmlFor={inputId}>{setting.label}</Label>
                    <p id={`${inputId}-help`} className="text-muted-foreground text-xs">
                      {setting.description}
                    </p>
                    {invalid ? (
                      <p className="text-destructive text-xs" role="alert">
                        Nhập một số nguyên từ {MIN_CONCURRENCY} đến {setting.max}.
                      </p>
                    ) : null}
                  </div>
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="numeric"
                    min={MIN_CONCURRENCY}
                    max={setting.max}
                    step={1}
                    value={drafts[key]}
                    aria-describedby={`${inputId}-help`}
                    aria-invalid={invalid}
                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                    className="w-20 shrink-0 tabular-nums"
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end">
            <Button type="submit" disabled={!changed || saving || refreshing}>
              Lưu
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
