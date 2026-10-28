"use client";

import { CloudUpload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";

// Starts or retries the archive of one render. It only uploads: the render is never made again.
export function ArchiveRenderButton({ renderId, retry }: Readonly<{ renderId: string; retry: boolean }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function archive(): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/renders/${renderId}/archive`, "POST");
      toast.success("Đã xếp việc lưu lên Google Drive. Worker sẽ upload.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => void archive()}>
      <CloudUpload aria-hidden />
      {retry ? "Thử lại lưu Drive" : "Lưu lên Drive"}
    </Button>
  );
}
