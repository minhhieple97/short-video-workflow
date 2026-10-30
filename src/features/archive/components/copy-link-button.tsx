"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Puts a link on the clipboard, for pasting into a post or a message.
export function CopyLinkButton({ url }: Readonly<{ url: string }>) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Đã sao chép link Drive.");
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Không sao chép được link. Hãy mở link rồi sao chép từ thanh địa chỉ.");
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void copy()}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Đã sao chép" : "Sao chép link"}
    </Button>
  );
}
