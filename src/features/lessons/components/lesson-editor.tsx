"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";

import { LESSON_TEXT_FIELDS, type LessonText } from "../domain/lesson-fields";
import { LessonTextFields, lessonTextComplete } from "./lesson-text-fields";

export function LessonEditor({ lessonId, initial }: Readonly<{ lessonId: string; initial: LessonText }>) {
  const router = useRouter();
  const [value, setValue] = useState<LessonText>(initial);
  const [pending, setPending] = useState(false);
  const dirty = LESSON_TEXT_FIELDS.some((field) => value[field] !== initial[field]);

  async function save(): Promise<void> {
    setPending(true);
    try {
      await sendJson(`/api/lessons/${lessonId}`, "PATCH", value);
      toast.success("Đã lưu bài học.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <LessonTextFields
        idPrefix="lesson"
        value={value}
        onChange={(field, text) => setValue((current) => ({ ...current, [field]: text }))}
      />
      <div>
        <Button onClick={() => void save()} disabled={!dirty || !lessonTextComplete(value) || pending}>
          <Save aria-hidden />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
