// Trimmed from a real `claude -p --model claude-opus-5-5 --effort xhigh --output-format json` call (2026-10-31): next to the
// model that did the task, the CLI lists the small model it calls for housekeeping on every run.
export const REAL_MODEL_USAGE = {
  "claude-haiku-5-5": { inputTokens: 1201, outputTokens: 20, costUSD: 0.0001301, thinkingTokens: 0 },
  "claude-opus-5-5": {
    inputTokens: 2,
    outputTokens: 76,
    cacheCreationInputTokens: 27364,
    costUSD: 0.22044,
    thinkingTokens: 0,
  },
};
