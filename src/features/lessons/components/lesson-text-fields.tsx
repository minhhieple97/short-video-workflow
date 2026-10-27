"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  LESSON_FIELD_LABELS,
  LESSON_TEXT_FIELDS,
  type LessonText,
  type LessonTextField,
} from "../domain/lesson-fields";

const HINTS: Partial<Record<LessonTextField, string>> = {
  realLifeScenario: "Tình huống minh họa mới, không trình bày như chuyện có thật trong sách.",
  actionableStep: "Một hành động cụ thể khán giả làm được ngay.",
};

interface LessonTextFieldsProps {
  value: LessonText;
  onChange: (field: LessonTextField, value: string) => void;
  idPrefix: string;
}

export function LessonTextFields({ value, onChange, idPrefix }: Readonly<LessonTextFieldsProps>) {
  return (
    <div className="flex flex-col gap-4">
      {LESSON_TEXT_FIELDS.map((field) => {
        const id = `${idPrefix}-${field}`;
        return (
          <div key={field} className="flex flex-col gap-2">
            <Label htmlFor={id}>{LESSON_FIELD_LABELS[field]}</Label>
            {field === "title" ? (
              <Input id={id} value={value[field]} maxLength={200} onChange={(e) => onChange(field, e.target.value)} />
            ) : (
              <Textarea
                id={id}
                value={value[field]}
                maxLength={2000}
                rows={field === "summary" ? 3 : 2}
                onChange={(e) => onChange(field, e.target.value)}
              />
            )}
            {HINTS[field] ? <p className="text-muted-foreground text-xs">{HINTS[field]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export const EMPTY_LESSON_TEXT: LessonText = {
  title: "",
  summary: "",
  principle: "",
  realLifeScenario: "",
  commonMistake: "",
  betterApproach: "",
  actionableStep: "",
};

export function lessonTextComplete(value: LessonText): boolean {
  return LESSON_TEXT_FIELDS.every((field) => value[field].trim().length > 0);
}
