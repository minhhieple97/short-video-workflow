import { Skeleton } from "@/components/ui/skeleton";

export default function BooksLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
    </div>
  );
}
