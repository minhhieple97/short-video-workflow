import { cn } from "@/lib/utils";

export type ProgressTone = "mint" | "blue" | "violet" | "amber" | "rose" | "slate";

export interface ProgressSegment {
  key: string;
  label: string;
  value: number;
  tone: ProgressTone;
  // For the part the worker is on right now.
  active?: boolean;
}

const BAR: Record<ProgressTone, string> = {
  mint: "bg-tone-mint-foreground",
  blue: "bg-tone-blue-foreground",
  violet: "bg-tone-violet-foreground",
  amber: "bg-tone-amber-foreground",
  rose: "bg-tone-rose-foreground",
  slate: "bg-tone-slate-foreground/50",
};

// A bar of real counts (chapters, pages), split by state, with a legend that always names each colour, so progress
// never rests on colour alone and never pretends to know how long the rest will take.
export function SegmentedProgress({
  label,
  summary,
  done,
  total,
  segments,
}: Readonly<{ label: string; summary: string; done: number; total: number; segments: readonly ProgressSegment[] }>) {
  const shown = segments.filter((segment) => segment.value > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{summary}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={summary}
        className="bg-muted flex h-2.5 overflow-hidden rounded-full"
      >
        {total > 0
          ? shown.map((segment) => (
              <div
                key={segment.key}
                className={cn(
                  "h-full transition-[width] duration-500",
                  BAR[segment.tone],
                  segment.active && "animate-pulse",
                )}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))
          : null}
      </div>
      {shown.length > 0 ? (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {shown.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", BAR[segment.tone])} />
              {segment.label}
              <span className="text-foreground font-medium tabular-nums">{segment.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
