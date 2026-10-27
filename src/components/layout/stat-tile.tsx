import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type Tone = "violet" | "orange" | "amber" | "mint" | "rose" | "blue" | "slate";

// Full class names are listed so Tailwind can see them at build time.
const ICON_TONE: Record<Tone, string> = {
  violet: "bg-tone-violet text-tone-violet-foreground",
  orange: "bg-tone-orange text-tone-orange-foreground",
  amber: "bg-tone-amber text-tone-amber-foreground",
  mint: "bg-tone-mint text-tone-mint-foreground",
  rose: "bg-tone-rose text-tone-rose-foreground",
  blue: "bg-tone-blue text-tone-blue-foreground",
  slate: "bg-tone-slate text-tone-slate-foreground",
};

interface StatTileProps {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: Tone;
}

export function StatTile({ label, value, icon: Icon, tone }: Readonly<StatTileProps>) {
  return (
    <div className="bg-card shadow-card ring-border flex flex-col gap-3 rounded-2xl p-4 ring-1 sm:gap-4 sm:p-5">
      <p className="text-muted-foreground flex items-center gap-3 text-sm font-medium">
        <span className={cn("flex size-9 items-center justify-center rounded-xl", ICON_TONE[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
        {label}
      </p>
      <p className="text-4xl leading-none font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
