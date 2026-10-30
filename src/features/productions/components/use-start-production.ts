"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";
import { errorMessage, sendJson } from "@/lib/api-client";

import type { ProductionDto } from "../schemas/production.dto";

// Sends one production request and moves to its progress page. The key lives as long as the form or dialog that uses
// this hook, so a double submit or a retry after a lost answer is the same request, never a second batch.
export function useStartProduction(bookId: string) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);

  async function start(request: { lessonIds: readonly string[]; range: DurationRange; pace: Pace }): Promise<void> {
    setPending(true);
    try {
      const production = await sendJson<ProductionDto & { reused: boolean }>("/api/productions", "POST", {
        bookId,
        lessonIds: request.lessonIds,
        idempotencyKey,
        ...request.range,
        pace: request.pace,
      });
      toast.success(
        production.reused
          ? "Yêu cầu này đã được gửi trước đó."
          : `Đã xếp ${production.items.length} video vào hàng sản xuất.`,
      );
      router.push(`/productions/${production.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return { pending, start };
}
