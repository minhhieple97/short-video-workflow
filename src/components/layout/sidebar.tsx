"use client";

import { BookOpen, Clapperboard, Factory, LayoutDashboard, ListChecks, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { SystemStatusDto } from "@/shared/types/system-status";

import { ThemeToggle } from "./theme-toggle";
import { useSystemStatus } from "./use-system-status";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/books", label: "Sách", icon: BookOpen },
  { href: "/videos", label: "Video", icon: Clapperboard },
  { href: "/productions", label: "Sản xuất", icon: Factory },
  { href: "/jobs", label: "Tác vụ", icon: ListChecks },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="bg-brand flex size-10 shrink-0 items-center justify-center rounded-xl" aria-hidden>
        <div className="bg-ink h-6 w-3.5 rounded-[5px]" />
      </div>
      <div className="min-w-0">
        <p className="text-base leading-tight font-extrabold text-white">Book Video Studio</p>
        <p className="text-xs text-white/60">Short video</p>
      </div>
    </div>
  );
}

function NavLinks({ activeJobs, layout }: Readonly<{ activeJobs: number; layout: "column" | "row" }>) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Điều hướng chính"
      className={cn("flex gap-1", layout === "column" ? "flex-col" : "overflow-x-auto pb-1")}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-raised"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
            {href === "/jobs" && activeJobs > 0 ? (
              <span
                className="bg-brand text-ink ml-auto inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full px-1.5 text-xs font-bold"
                aria-label={`${activeJobs} tác vụ đang chạy`}
              >
                {activeJobs}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function StatusCard({ status }: Readonly<{ status: SystemStatusDto | null }>) {
  const dot = status === null ? "bg-white/40" : status.worker === "running" ? "bg-emerald-400" : "bg-amber-400";
  const label =
    status === null ? "Đang kiểm tra…" : status.worker === "running" ? "Worker đang chạy" : "Worker chưa chạy";

  return (
    <div className="bg-sidebar-accent flex flex-col gap-2.5 rounded-2xl p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-white" role="status">
        <span className={cn("size-2.5 rounded-full", dot)} aria-hidden />
        {label}
      </p>
      {status ? (
        <p className="text-sidebar-foreground flex items-center justify-between text-xs">
          <span>Chế độ AI</span>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-semibold text-white">{status.aiMode}</span>
        </p>
      ) : null}
      <div className="text-sidebar-foreground flex items-center justify-between text-xs">
        <span>Giao diện</span>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function Sidebar() {
  const status = useSystemStatus();
  const activeJobs = status?.activeJobs ?? 0;

  return (
    <>
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-8 overflow-y-auto border-r p-4 md:flex">
        <Brand />
        <NavLinks activeJobs={activeJobs} layout="column" />
        <div className="mt-auto">
          <StatusCard status={status} />
        </div>
      </aside>
      <header className="bg-sidebar flex flex-col gap-3 px-4 pt-4 pb-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Brand />
          <ThemeToggle />
        </div>
        <NavLinks activeJobs={activeJobs} layout="row" />
      </header>
    </>
  );
}
