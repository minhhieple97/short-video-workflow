#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests. Answers `auth status --json` and `-p` like the real binary.
// FAKE_CLAUDE_MODE: "ok" (structured_output), "quota", "quota-30m", "quota-1h", "logged-out", "bad-output", "slow".
// FAKE_CLAUDE_LOG receives the arguments and the security-relevant environment of the `-p` call.
import fs from "node:fs";

const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
const args = process.argv.slice(2);

if (args[0] === "auth") {
  process.stdout.write(JSON.stringify({ loggedIn: mode !== "logged-out", authMethod: "claude.ai" }));
  process.exit(0);
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
process.stdin.on("end", () => {
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.writeFileSync(
      process.env.FAKE_CLAUDE_LOG,
      JSON.stringify({
        args,
        promptLength: prompt.length,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
        claudeCodeSession: process.env.CLAUDECODE ?? null,
      }),
    );
  }
  if (mode === "slow") {
    setTimeout(() => {}, 60_000);
    return;
  }
  if (["quota", "quota-30m", "quota-1h"].includes(mode)) {
    const result =
      mode === "quota-30m"
        ? "You've hit your limit · resets in 30 minutes"
        : mode === "quota-1h"
          ? "You've hit your limit · resets in 1 hour"
          : "Claude AI usage limit reached";
    process.stdout.write(JSON.stringify({ type: "result", is_error: true, result }));
    process.exit(1);
  }
  const structured = mode === "bad-output" ? { unexpected: true } : JSON.parse(process.env.FAKE_CLAUDE_OUTPUT ?? "{}");
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: structured }));
});
