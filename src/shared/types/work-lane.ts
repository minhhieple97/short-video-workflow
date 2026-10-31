import { z } from "zod";

// A lane is one kind of work, named after what limits it (the Claude account, the voice service, the CPU and Chromium,
// Google Drive, NotebookLM...). Each lane has its own queue and its own number of tasks at once.
export const WORK_LANES = ["general", "claude", "notebooklm", "voice", "render", "archive", "extraction"] as const;
export type WorkLane = (typeof WORK_LANES)[number];

export const workLaneSchema = z.enum(WORK_LANES);

// Light bookkeeping (diagnostics, the production steps that only read or write the database, waiting on a render) is not a
// setting: it never holds a scarce resource.
export const GENERAL_LANE_CONCURRENCY = 2;
