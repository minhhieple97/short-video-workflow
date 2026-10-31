import { z } from "zod";

import { CONCURRENCY_SETTINGS, MIN_CONCURRENCY, type ConcurrencyKey } from "../domain/concurrency-settings";

const valueFor = (key: ConcurrencyKey) =>
  z
    .number({ error: `${CONCURRENCY_SETTINGS[key].label}: hãy nhập một số.` })
    .int(`${CONCURRENCY_SETTINGS[key].label}: hãy nhập số nguyên.`)
    .min(MIN_CONCURRENCY, `${CONCURRENCY_SETTINGS[key].label}: ít nhất ${MIN_CONCURRENCY}.`)
    .max(
      CONCURRENCY_SETTINGS[key].max,
      `${CONCURRENCY_SETTINGS[key].label}: nhiều nhất ${CONCURRENCY_SETTINGS[key].max}.`,
    );

export const concurrencySettingsSchema = z.strictObject({
  claude: valueFor("claude"),
  notebooklm: valueFor("notebooklm"),
  voice: valueFor("voice"),
  render: valueFor("render"),
  renderThreads: valueFor("renderThreads"),
  archive: valueFor("archive"),
  extraction: valueFor("extraction"),
});
