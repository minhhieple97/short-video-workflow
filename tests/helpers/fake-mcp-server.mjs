// A stand-in MCP server for tests, speaking newline-delimited JSON-RPC on stdio. FAKE_MCP_MODE (comma-separated) picks
// misbehaviours; FAKE_MCP_LOG records every message it receives.
import fs from "node:fs";

const modes = new Set((process.env.FAKE_MCP_MODE ?? "").split(",").filter(Boolean));
const log = process.env.FAKE_MCP_LOG;
const protocol = process.env.FAKE_MCP_PROTOCOL ?? "2025-06-18";
let buffer = "";
let pingId = 1000;
const waitingForPing = new Map();

// "stay-open" keeps running after stdin closes, like a server that does not notice its client went away.
const stayOpen = modes.has("stay-open") || modes.has("ignore-sigterm");
if (stayOpen) setInterval(() => undefined, 1000);
if (modes.has("ignore-sigterm")) process.on("SIGTERM", () => undefined);
else
  process.on("SIGTERM", () => {
    if (log) fs.appendFileSync(log, `${JSON.stringify({ signal: "SIGTERM" })}\n`);
    process.exit(0);
  });
if (modes.has("stderr-secret")) process.stderr.write("cookie=SID-SECRET-VALUE\n");

const send = (message) => {
  if (modes.has("garbage")) process.stdout.write("this is not json\n");
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

// FAKE_MCP_PERSONA=notebooklm answers like notebooklm-mcp-cli: {"status": ...} envelopes reported with isError false,
// a process-wide active profile, and scripted answers per tool from FAKE_NLM_SCRIPT ({ tool: [answer, ...] }).
const notebooklm = process.env.FAKE_MCP_PERSONA === "notebooklm";
const nlmTools = (
  process.env.FAKE_NLM_TOOLS ??
  "profile,notebook_list,notebook_create,notebook_get,notebook_query,source_add,source_get_content,source_delete,usage_get,server_info"
).split(",");
const nlmProfiles = (process.env.FAKE_NLM_PROFILES ?? "default").split(",");
const nlmScript = process.env.FAKE_NLM_SCRIPT ? JSON.parse(fs.readFileSync(process.env.FAKE_NLM_SCRIPT, "utf8")) : {};
// FAKE_NLM_QUERY_RULES (a JSON file of [{ contains, answer }]) answers notebook_query by what the question asks for.
const queryRules = process.env.FAKE_NLM_QUERY_RULES
  ? JSON.parse(fs.readFileSync(process.env.FAKE_NLM_QUERY_RULES, "utf8"))
  : [];
let activeProfile = "default";

// FAKE_NLM_STATE (a JSON file) holds notebooks and sources across server processes, like the real account would.
const statePath = process.env.FAKE_NLM_STATE;
const loadState = () =>
  statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { notebooks: [], next: 1 };
const saveState = (state) => statePath && fs.writeFileSync(statePath, JSON.stringify(state));

function statefulAnswer(name, args) {
  const state = loadState();
  const notebookOf = (id) => state.notebooks.find((notebook) => notebook.id === id);
  if (name === "notebook_create") {
    const notebook = { id: `nb-${state.next++}`, title: args.title, sources: [] };
    state.notebooks.push(notebook);
    saveState(state);
    return { status: "success", notebook_id: notebook.id, notebook: { id: notebook.id, title: notebook.title } };
  }
  if (name === "notebook_list") {
    const notebooks = state.notebooks.slice(0, args.max_results ?? 100);
    return {
      status: "success",
      notebooks: notebooks.map(({ id, title, sources }) => ({ id, title, source_count: sources.length })),
    };
  }
  if (name === "notebook_get") {
    const notebook = notebookOf(args.notebook_id);
    if (!notebook) return { status: "error", error: "Notebook not found" };
    return {
      status: "success",
      notebook: { id: notebook.id, title: notebook.title },
      sources: notebook.sources.map(({ id, title }) => ({ id, title })),
    };
  }
  if (name === "source_add") {
    const notebook = notebookOf(args.notebook_id);
    if (!notebook) return { status: "error", error: "Notebook not found" };
    const source = { id: `src-${state.next++}`, title: args.title, length: (args.text ?? "").length };
    notebook.sources.push(source);
    saveState(state);
    return {
      status: "success",
      ready: args.wait === true,
      source_type: args.source_type,
      source_id: source.id,
      title: source.title,
    };
  }
  if (name === "notebook_query") {
    return {
      status: "success",
      answer: `Trả lời: ${args.query}`,
      conversation_id: "conv-1",
      sources_used: args.source_ids ?? [],
      citations: {},
    };
  }
  return null;
}

function notebooklmAnswer(name, args) {
  if (name === "profile") {
    if (args.action === "switch") {
      if (!nlmProfiles.includes(args.name)) return { status: "error", error: `Profile '${args.name}' not found` };
      // Like a server started with NOTEBOOKLM_COOKIES: it answers but stays on its own account.
      if (process.env.FAKE_NLM_IGNORE_SWITCH !== "1") activeProfile = args.name;
      return { status: "success", active: { profile: activeProfile, source: "session" } };
    }
    return {
      status: "success",
      active: { profile: activeProfile, source: "saved default", saved_default: "default" },
      profiles: nlmProfiles.map((profile) => ({ name: profile })),
    };
  }
  const queued = nlmScript[name];
  if (Array.isArray(queued) && queued.length > 0) {
    const next = queued.shift();
    // Consumed faults stay consumed for the next server process too.
    if (process.env.FAKE_NLM_SCRIPT) fs.writeFileSync(process.env.FAKE_NLM_SCRIPT, JSON.stringify(nlmScript));
    if (next.__applyThenHang) {
      statefulAnswer(name, args);
      return { __hang: true };
    }
    return next;
  }
  if (name === "notebook_query") {
    const rule = queryRules.find((candidate) => String(args.query ?? "").includes(candidate.contains));
    if (rule) return rule.answer;
  }
  if (statePath) {
    const answer = statefulAnswer(name, args);
    if (answer) return answer;
  }
  return { status: "success", tool: name, profile: activeProfile, args };
}

function handle(message) {
  if (log) fs.appendFileSync(log, `${JSON.stringify(message)}\n`);
  if (message.id !== undefined && waitingForPing.has(message.id)) {
    waitingForPing.get(message.id)(message);
    waitingForPing.delete(message.id);
    return;
  }
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: protocol,
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp", version: "9.9" },
      },
    });
    return;
  }
  if (message.method === "tools/list" && notebooklm) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: nlmTools.map((name) => ({ name, inputSchema: { type: "object" } })) },
    });
    return;
  }
  if (message.method === "tools/call" && notebooklm) {
    const answer = notebooklmAnswer(message.params.name, message.params.arguments ?? {});
    if (answer.__hang) return;
    if (answer.__textOnly) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(answer.body) }], isError: false },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        structuredContent: answer,
        isError: answer.__isError === true,
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    const page2 = message.params?.cursor === "page-2";
    const tools = page2
      ? [{ name: "env", inputSchema: { type: "object" } }]
      : [{ name: "echo", inputSchema: { type: "object" } }];
    send({ jsonrpc: "2.0", id: message.id, result: { tools, ...(page2 ? {} : { nextCursor: "page-2" }) } });
    return;
  }
  if (message.method === "tools/call") {
    if (modes.has("crash-on-call")) process.exit(3);
    if (modes.has("hang-on-call")) return;
    if (modes.has("rpc-error")) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "bad params with cookie=SECRET" } });
      return;
    }
    const answer = () => {
      const { name, arguments: args } = message.params;
      const structured =
        name === "env"
          ? { status: "success", keys: Object.keys(process.env).sort() }
          : { status: "success", echo: args };
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(structured) }],
          structuredContent: structured,
          isError: false,
        },
      });
    };
    if (modes.has("ping-first")) {
      const id = pingId++;
      waitingForPing.set(id, (reply) => {
        if (log) fs.appendFileSync(log, `${JSON.stringify({ pingReply: reply })}\n`);
        answer();
      });
      send({ jsonrpc: "2.0", id, method: "ping" });
      return;
    }
    answer();
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "nope" } });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => {
  if (!stayOpen) process.exit(0);
});
