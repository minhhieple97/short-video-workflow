import { cn } from "@/lib/utils";

import type { DurationBudget } from "../domain/duration";

const BAR_COLOR: Record<DurationBudget["level"], string> = {
  empty: "bg-muted-foreground/40",
  short: "bg-sky-500",
  ok: "bg-emerald-500",
  near: "bg-amber-500",
  over: "bg-red-500",
};

export function DurationBudgetBar({ budget }: Readonly<{ budget: DurationBudget }>) {
  const percent = Math.min(100, Math.round(budget.ratio * 100));
  return (
    <div className="flex flex-col gap-1" aria-label="Ngân sách thời lượng">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">Thời lượng ước tính</span>
        <span className={cn("tabular-nums", budget.level === "over" && "text-red-600 dark:text-red-400")}>
          {budget.totalSeconds}s / {budget.targetSeconds}s
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", BAR_COLOR[budget.level])}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{budget.message} Thời lượng thật sẽ đo từ audio (M5).</p>
    </div>
  );
}
