import fs from "node:fs";
import path from "node:path";

import type { NotebookStudioSettings } from "@/features/notebooklm/services/notebook-studio.service";

const SERVER = path.join(import.meta.dirname, "fake-mcp-server.mjs");

export interface FakeNotebookLm {
  settings: NotebookStudioSettings;
  // Queues answers per tool for the next calls (consumed in order, across server processes).
  script(answers: Record<string, unknown[]>): void;
  // Answers every later notebook_query whose question contains `contains` (when nothing is queued).
  answerQueries(rules: { contains: string; answer: unknown }[]): void;
  calls(tool: string): Record<string, unknown>[];
  remote(): { notebooks: { id: string; title: string; sources: { id: string; title: string; length: number }[] }[] };
}

// The fake MCP server in its NotebookLM role, with notebooks and sources kept in a file like a real account would.
export function fakeNotebookLm(directory: string): FakeNotebookLm {
  fs.mkdirSync(directory, { recursive: true });
  const statePath = path.join(directory, "nlm-state.json");
  const scriptPath = path.join(directory, "nlm-script.json");
  const logPath = path.join(directory, "nlm-log.jsonl");
  const rulesPath = path.join(directory, "nlm-query-rules.json");
  fs.writeFileSync(scriptPath, "{}");
  fs.writeFileSync(rulesPath, "[]");
  return {
    settings: {
      profile: "default",
      callTimeoutMs: 5_000,
      server: {
        command: process.execPath,
        args: [SERVER],
        env: {
          PATH: process.env.PATH ?? "",
          FAKE_MCP_PERSONA: "notebooklm",
          FAKE_MCP_LOG: logPath,
          FAKE_NLM_STATE: statePath,
          FAKE_NLM_SCRIPT: scriptPath,
          FAKE_NLM_QUERY_RULES: rulesPath,
        },
      },
    },
    script: (answers) => fs.writeFileSync(scriptPath, JSON.stringify(answers)),
    answerQueries: (rules) => fs.writeFileSync(rulesPath, JSON.stringify(rules)),
    calls: (tool) =>
      fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, "utf8")
            .trim()
            .split("\n")
            .map(
              (line) =>
                JSON.parse(line) as {
                  method?: string;
                  params?: { name?: string; arguments?: Record<string, unknown> };
                },
            )
            .filter((message) => message.method === "tools/call" && message.params?.name === tool)
            .map((message) => message.params?.arguments ?? {})
        : [],
    remote: () => (fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { notebooks: [] }),
  };
}

// An answer the way notebooklm-mcp-cli returns one: prose around a fenced JSON block.
export function notebookAnswer(json: unknown): Record<string, unknown> {
  return {
    status: "success",
    answer: `Dưới đây là kết quả:\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\nCác ý trên dựa trên nguồn [1].`,
    conversation_id: "conv-test",
    sources_used: [],
  };
}
