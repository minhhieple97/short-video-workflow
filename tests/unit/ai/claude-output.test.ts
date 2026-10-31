import { describe, expect, it } from "vitest";

import {
  classifyCliFailure,
  extractJsonObject,
  isRequestedModel,
  parseClaudeEnvelope,
  sanitizeClaudeEnv,
} from "@/server/ai/cli-task/claude-output";

import { REAL_MODEL_USAGE } from "../../helpers/fixtures/real-model-usage";

const envelopeWith = (modelUsage: unknown) => JSON.stringify({ is_error: false, result: "", modelUsage });

describe("Claude CLI output handling", () => {
  it("reads the JSON envelope, including structured output", () => {
    expect(parseClaudeEnvelope('{"type":"result","is_error":false,"result":"{\\"a\\":1}"}')).toEqual({
      isError: false,
      text: '{"a":1}',
      structured: undefined,
    });
    expect(parseClaudeEnvelope('{"is_error":true,"result":"boom","structured_output":{"a":2}}')).toMatchObject({
      isError: true,
      structured: { a: 2 },
    });
  });

  it("names the model that did the work, not the helper model the CLI lists beside it", () => {
    const real = parseClaudeEnvelope(envelopeWith(REAL_MODEL_USAGE));
    expect(real.models).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(real.primaryModel).toBe("claude-opus-5-5");

    const swapped = { ...REAL_MODEL_USAGE, "claude-sonnet-5-5": { outputTokens: 900, costUSD: 0.04 } };
    expect(parseClaudeEnvelope(envelopeWith(swapped)).primaryModel).toBe("claude-opus-5-5");
    const withoutCost = { "claude-haiku-5-5": { outputTokens: 20 }, "claude-sonnet-5-5": { outputTokens: 900 } };
    expect(parseClaudeEnvelope(envelopeWith(withoutCost)).primaryModel).toBe("claude-sonnet-5-5");
  });

  it("reports one model as the primary one, and none when the CLI reported no usage", () => {
    expect(parseClaudeEnvelope(envelopeWith({ "claude-opus-5-5": {} })).primaryModel).toBe("claude-opus-5-5");
    expect(parseClaudeEnvelope(envelopeWith({}))).not.toHaveProperty("primaryModel");
    const none = parseClaudeEnvelope('{"is_error":false,"result":"x"}');
    expect(none.models).toBeUndefined();
    expect(none.primaryModel).toBeUndefined();
  });

  it("takes a dated snapshot of the requested model for the requested model, and nothing else", () => {
    expect(isRequestedModel("claude-opus-5-5", "claude-opus-5-5")).toBe(true);
    expect(isRequestedModel("claude-opus-5-5-20261001", "claude-opus-5-5")).toBe(true);
    expect(isRequestedModel("claude-sonnet-5-5", "claude-opus-5-5")).toBe(false);
    expect(isRequestedModel("claude-opus-5-50", "claude-opus-5-5")).toBe(false);
  });

  it("extracts a JSON object from fenced or chatty text", () => {
    expect(extractJsonObject('Đây là kết quả:\n```json\n{"chapterId":"c1","lessons":[]}\n```')).toEqual({
      chapterId: "c1",
      lessons: [],
    });
    expect(() => extractJsonObject("không có JSON")).toThrow();
  });

  it("classifies quota and authentication failures so they are not retried blindly", () => {
    expect(classifyCliFailure("Claude AI usage limit reached")).toBe("QUOTA");
    expect(classifyCliFailure("Error 429 Too Many Requests")).toBe("QUOTA");
    expect(classifyCliFailure("Not logged in · Please run /login")).toBe("AUTH");
    expect(classifyCliFailure("something else")).toBe("OTHER");
  });

  it("drops Claude Code session variables and API keys from the child environment", () => {
    const env = sanitizeClaudeEnv({
      NODE_ENV: "test",
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      ANTHROPIC_API_KEY: "secret",
      ANTHROPIC_AUTH_TOKEN: "secret",
      HOME: "/home/me",
    });
    expect(Object.keys(env).sort()).toEqual(["HOME", "NODE_ENV", "PATH"]);
  });
});
