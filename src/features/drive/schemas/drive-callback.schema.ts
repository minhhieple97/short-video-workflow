import { z } from "zod";

const param = z.string().min(1).max(2048).optional();

export const driveCallbackQuerySchema = z.object({ state: param, code: param, error: param });
