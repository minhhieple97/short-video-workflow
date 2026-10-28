import { Skeleton } from "@/components/ui/skeleton";

export default function ProductionsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full" />
      ))}
    </div>
  );
}
