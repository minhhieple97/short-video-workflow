import { z } from "zod";

// Loose on purpose: a caption that breaks a rule must not fail the script it comes with. acceptPublishMetadata() applies
// the rules once the output is in.
export const publishMetadataDraftSchema = z.object({
  title: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

export const publishBookSchema = z.object({ title: z.string(), author: z.string().nullable() });

export type PublishBook = z.infer<typeof publishBookSchema>;
