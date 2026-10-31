"use client";

import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiRequest, errorMessage } from "@/lib/api-client";

import type { BookDriveLinksDto } from "../schemas/archive.dto";
import { DriveLinkList } from "./drive-link-list";

type Loaded = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; links: BookDriveLinksDto };

// Opens the list of a book's videos with their Drive links. The list is asked for only when it is opened, and again
// whenever `refreshKey` changes while it is open (a video finished, a file reached Drive), so a batch's page stays light
// however many videos it made and the list is never older than the numbers above it.
export function BookDriveLinks({ bookId, refreshKey }: Readonly<{ bookId: string; refreshKey: string }>) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    apiRequest<BookDriveLinksDto>(`/api/books/${bookId}/drive-links`, { signal: controller.signal })
      .then((links) => setLoaded({ kind: "ready", links }))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setLoaded({ kind: "failed", message: errorMessage(failure) });
      });
    return () => controller.abort();
  }, [open, bookId, refreshKey]);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          Link Drive của video
        </Button>
      </div>
      {open ? (
        <div id={panelId}>
          {loaded.kind === "loading" ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Đang tải danh sách…
            </p>
          ) : null}
          {loaded.kind === "failed" ? (
            <Alert variant="destructive">
              <AlertDescription>{loaded.message}</AlertDescription>
            </Alert>
          ) : null}
          {loaded.kind === "ready" ? <DriveLinkList videos={loaded.links.videos} /> : null}
        </div>
      ) : null}
    </div>
  );
}
