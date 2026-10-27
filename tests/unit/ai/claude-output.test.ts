import { describe, expect, it } from "vitest";

import {
  classifyCliFailure,
  extractJsonObject,
  parseClaudeEnvelope,
  sanitizeClaudeEnv,
} from "@/server/ai/cli-task/claude-output";

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
