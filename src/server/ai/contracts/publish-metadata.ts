import { z } from "zod";

import { lessonSnapshotSchema } from "@/features/videos/domain/lesson-snapshot";

// Loose on purpose: a caption that breaks a rule must not fail the script it comes with. acceptPublishMetadata() applies
// the rules once the output is in.
export const publishMetadataDraftSchema = z.object({
  title: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

export const publishBookSchema = z.object({ title: z.string(), author: z.string().nullable() });

export type PublishBook = z.infer<typeof publishBookSchema>;

// For a title, caption and hashtags written on their own (the "Tạo lại" button): the script as it is now, the book's
// name and the lessons the video uses. Never chapter text.
export const publishMetadataInputSchema = z.object({
  videoId: z.string(),
  book: publishBookSchema,
  lessons: z.array(lessonSnapshotSchema).min(1),
  // The visible scenes in order, HOOK first.
  scenes: z
    .array(
      z.object({ type: z.string(), title: z.string().nullable(), narration: z.string(), onScreenText: z.string() }),
    )
    .min(1),
  promptVersion: z.string(),
});

export const publishMetadataOutputSchema = z.object({
  videoId: z.string(),
  publish: publishMetadataDraftSchema,
});

export type PublishMetadataInput = z.infer<typeof publishMetadataInputSchema>;
export type PublishMetadataOutput = z.infer<typeof publishMetadataOutputSchema>;
