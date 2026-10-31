"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Puts text on the clipboard, for pasting into a post, a message or a sheet.
export function CopyButton({
  text,
  label,
  successMessage,
}: Readonly<{ text: string; label: string; successMessage: string }>) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(successMessage);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Không sao chép được. Hãy mở từng link rồi sao chép từ thanh địa chỉ.");
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void copy()}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Đã sao chép" : label}
    </Button>
  );
}
