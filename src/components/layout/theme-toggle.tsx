"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const OPTIONS: readonly { value: string; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Giao diện sáng", icon: Sun },
  { value: "dark", label: "Giao diện tối", icon: Moon },
  { value: "system", label: "Theo hệ thống", icon: Monitor },
];

const subscribeNothing = () => () => undefined;

// Sits on the always-dark sidebar, so it is styled with white-on-ink rather than theme tokens.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div role="group" aria-label="Giao diện" className="flex gap-0.5 rounded-full bg-white/10 p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "focus-visible:ring-ring flex size-7 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2",
            current === value ? "text-ink bg-white" : "text-sidebar-foreground hover:text-white",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
