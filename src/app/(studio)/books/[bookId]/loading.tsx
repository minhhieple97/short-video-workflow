import { Skeleton } from "@/components/ui/skeleton";

export default function BookLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải sách">
      <Skeleton className="h-4 w-56" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <div className="flex gap-6">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-24" />
        ))}
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
