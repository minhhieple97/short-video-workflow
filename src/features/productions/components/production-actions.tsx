"use client";

import { RotateCcw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";

interface ProductionActionProps {
  productionId: string;
  // Acts on one video of the batch; without it, on every video the action applies to.
  itemId?: string;
  size?: "sm" | "default";
}

function useProductionAction(productionId: string, itemId: string | undefined) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run(action: "cancel" | "retry", success: string): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/productions/${productionId}/${action}`, "POST", itemId ? { itemId } : {});
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return { pending, run };
}

export function RetryProductionButton({ productionId, itemId, size = "default" }: Readonly<ProductionActionProps>) {
  const { pending, run } = useProductionAction(productionId, itemId);
  return (
    <Button
      size={size}
      variant="outline"
      disabled={pending}
      onClick={() => void run("retry", itemId ? "Đã xếp lại video này." : "Đã xếp lại các video lỗi hoặc đã huỷ.")}
    >
      <RotateCcw aria-hidden />
      {itemId ? "Thử lại" : "Thử lại các video lỗi"}
    </Button>
  );
}

export function CancelProductionButton({ productionId, itemId, size = "default" }: Readonly<ProductionActionProps>) {
  const { pending, run } = useProductionAction(productionId, itemId);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size={size} variant="outline" disabled={pending}>
          <Square aria-hidden />
          {itemId ? "Huỷ" : "Huỷ đợt sản xuất"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{itemId ? "Huỷ video này?" : "Huỷ mọi video chưa xong?"}</AlertDialogTitle>
          <AlertDialogDescription>
            Bước đang chạy sẽ làm xong rồi dừng; không bước nào sau đó bắt đầu. Bản render đang chờ cũng bị huỷ. Phần đã
            làm được giữ lại, bạn có thể thử lại sau.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Không</AlertDialogCancel>
          <AlertDialogAction onClick={() => void run("cancel", "Đã huỷ.")}>Huỷ</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
