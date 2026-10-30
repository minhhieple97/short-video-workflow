"use client";

import { useState } from "react";

import type { PdfImportSettings } from "@/features/book-imports/schemas/book-import.dto";

import type { ImportPreview } from "../../schemas/book.dto";
import { ImportReview } from "./import-review";
import { ImportSourceForm } from "./import-source-form";

export function ImportWizard({
  settings,
  maxTextBytes,
  initialAutomatic,
}: Readonly<{ settings: PdfImportSettings; maxTextBytes: number; initialAutomatic: boolean }>) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  return preview ? (
    <ImportReview key={preview.importId} preview={preview} onBack={() => setPreview(null)} />
  ) : (
    <ImportSourceForm
      onPreview={setPreview}
      settings={settings}
      maxTextBytes={maxTextBytes}
      initialAutomatic={initialAutomatic}
    />
  );
}
