import { cn } from "@/lib/utils";

import type { DurationBudget } from "../domain/duration";

const BAR_COLOR: Record<DurationBudget["level"], string> = {
  empty: "bg-muted-foreground/40",
  short: "bg-[#5b7bff]",
  ok: "bg-[#12a37a]",
  near: "bg-[#f5a524]",
  over: "bg-[#e5446d]",
};

export function DurationBudgetBar({ budget, withAudio }: Readonly<{ budget: DurationBudget; withAudio: boolean }>) {
  const percent = Math.min(100, Math.round(budget.ratio * 100));
  return (
    <div className="flex flex-col gap-1" aria-label="Ngân sách thời lượng">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">Thời lượng ước tính</span>
        <span className={cn("tabular-nums", budget.level === "over" && "text-red-600 dark:text-red-400")}>
          {budget.totalSeconds}s / {budget.targetSeconds}s
        </span>
      </div>
      <div className="bg-muted h-2.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", BAR_COLOR[budget.level])}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {budget.message}{" "}
        {withAudio ? "Tính theo âm thanh thật của từng cảnh." : "Cảnh chưa có giọng đọc dùng thời lượng ước tính."}
      </p>
    </div>
  );
}
