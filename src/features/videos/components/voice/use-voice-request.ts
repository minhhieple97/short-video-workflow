"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api-client";

// Asks for voices and stays busy until the page has been drawn again with those scenes in the queue, so the buttons are
// never enabled in the gap between the request and the queue state arriving. `send` resolves to how many scenes it queued.
export function useVoiceRequest() {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  async function request(send: () => Promise<number>): Promise<void> {
    setSending(true);
    try {
      const count = await send();
      toast.info(count === 0 ? "Không có cảnh nào cần tạo giọng." : `Đã xếp ${count} cảnh vào hàng đợi tạo giọng.`);
      startRefresh(() => router.refresh());
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return { busy: sending || refreshing, request };
}
