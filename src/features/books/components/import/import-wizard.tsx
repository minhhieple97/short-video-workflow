"use client";

import { useState } from "react";

import type { ImportPreview } from "../../schemas/book.dto";
import { ImportReview } from "./import-review";
import { ImportSourceForm } from "./import-source-form";

export function ImportWizard({ maxPdfBytes }: Readonly<{ maxPdfBytes: number }>) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  return preview ? (
    <ImportReview key={preview.importId} preview={preview} onBack={() => setPreview(null)} />
  ) : (
    <ImportSourceForm onPreview={setPreview} maxPdfBytes={maxPdfBytes} />
  );
}
