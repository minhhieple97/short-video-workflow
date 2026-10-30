"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { truncateText } from "@/lib/format";

import { LESSON_STATUS_LABELS, LESSON_STATUSES } from "../domain/lesson-fields";
import { LESSON_PAGE_PARAM } from "../domain/paging";
import type { ChapterRef } from "../schemas/lesson.dto";

const ALL = "all";

interface FilterSelectProps {
  label: string;
  param: string;
  options: readonly { value: string; label: string }[];
}

function FilterSelect({ label, param, options }: Readonly<FilterSelectProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(value: string): void {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "lessons");
    next.delete(LESSON_PAGE_PARAM);
    if (value === ALL) next.delete(param);
    else next.set(param, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <Select value={searchParams.get(param) ?? ALL} onValueChange={update}>
      <SelectTrigger className="w-52" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: tất cả</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LessonFilters({ chapters }: Readonly<{ chapters: readonly ChapterRef[] }>) {
  return (
    <div className="flex flex-wrap gap-2">
      <FilterSelect
        label="Chương"
        param="chapter"
        options={chapters.map((chapter) => ({
          value: chapter.id,
          label: `${chapter.order}. ${truncateText(chapter.title, 60)}`,
        }))}
      />
      <FilterSelect
        label="Trạng thái"
        param="status"
        options={LESSON_STATUSES.map((status) => ({ value: status, label: LESSON_STATUS_LABELS[status] }))}
      />
      <FilterSelect
        label="Sử dụng"
        param="usage"
        options={[
          { value: "used", label: "Đã dùng trong video" },
          { value: "unused", label: "Chưa dùng" },
        ]}
      />
    </div>
  );
}
