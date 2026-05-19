#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const BRIDGE_DIR = path.dirname(new URL(import.meta.url).pathname);
const DEFAULT_BASE_URL = "wss://api.XiaoZhi.me/mcp/";
const TOKEN_ENV = "XIAOZHI_MCP_TOKEN";
const BASE_URL_ENV = "XIAOZHI_MCP_BASE_URL";
const DRY_RUN_ENV = "XIAOZHI_MCP_DRY_RUN";
const DEBUG_ENV = "XIAOZHI_MCP_DEBUG";
const PLAN_STATE_FILE_ENV = "XIAOZHI_PLAN_STATE_FILE";
const DEFAULT_PLAN_STATE_FILE = path.join(BRIDGE_DIR, "state", "plan_status.json");
const ECHO_MAX_CHARS = 1024;
const LOG_VALUE_MAX_CHARS = 120;
const PLAN_STATE_MAX_BYTES = 64 * 1024;
const DEFAULT_EVENT_TTL_SECONDS = 300;
const LOCAL_CALL_ALLOWED_TOOLS = new Set(["ping", "echo", "get_time", "get_plan_status", "get_latest_completion_event"]);

const tools = [
  {
    name: "ping",
    description: "Call this when the user asks to test MCP, ping the bridge, or check whether external tools are online. Returns pong.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "echo",
    description: `Call this when the user asks to return a piece of text exactly as provided, or to test argument passing. Echoes a short text string up to ${ECHO_MAX_CHARS} characters.`,
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: `Text to echo, maximum ${ECHO_MAX_CHARS} characters.`,
          maxLength: ECHO_MAX_CHARS,
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "get_time",
    description: "Call this when the user asks for the current time, or wants to test a real-time tool. Returns the current Asia/Shanghai time.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_plan_status",
    description: "Read the sanitized local OpenClaw plan status snapshot. Returns only whitelisted plan/task fields; does not read raw OpenClaw plan files.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_latest_completion_event",
    description: "Read the latest sanitized completion event from the local plan status snapshot and compute whether it is still eligible for celebration.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run") || process.env[DRY_RUN_ENV] === "1";
const debugEnabled = args.has("--debug") || process.env[DEBUG_ENV] === "1";
const localCall = parseLocalCallArgs(argv);

if (localCall) {
  runLocalCall(localCall);
  process.exit(0);
}

if (dryRun) {
  console.log("XiaoZhi MCP bridge dry-run: no network connection will be opened.");
  console.log(JSON.stringify({ tools }, null, 2));
  process.exit(0);
}

if (typeof WebSocket !== "function") {
  console.error("Node.js global WebSocket is not available. Please use Node.js >= 22.");
  process.exit(1);
}

const token = process.env[TOKEN_ENV];
const baseUrl = process.env[BASE_URL_ENV] || DEFAULT_BASE_URL;

if (!token) {
  printUsage();
  process.exit(1);
}

let endpoint;
try {
  endpoint = buildEndpointUrl(baseUrl, token);
} catch (error) {
  console.error(`Invalid ${BASE_URL_ENV}: ${error.message}`);
  process.exit(1);
}

console.log("Starting minimal XiaoZhi MCP bridge.");
console.log(`Endpoint: ${safeUrlForLog(endpoint)}`);
console.log(`Token: set (${token.length} chars)`);
console.log("Exposed tools: ping, echo, get_time, get_plan_status, get_latest_completion_event");

const ws = new WebSocket(endpoint.href);
let heartbeatTimer;

ws.addEventListener("open", () => {
  console.log("WebSocket connected.");
  heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping" }));
    }
  }, 30_000);
});

ws.addEventListener("message", async (event) => {
  const text = await messageDataToText(event.data);
  await handleIncomingMessage(ws, text);
});

ws.addEventListener("close", (event) => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.log(`WebSocket closed: code=${event.code} reason=${sanitizeLogValue(event.reason || "<none>")}`);
});

ws.addEventListener("error", () => {
  console.error("WebSocket error occurred. Details are intentionally not expanded to avoid leaking credentials.");
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function parseLocalCallArgs(rawArgv) {
  const index = rawArgv.indexOf("--local-call");
  if (index === -1) return null;
  const toolName = rawArgv[index + 1];
  const rawJsonArgs = rawArgv[index + 2] ?? "{}";
  if (!toolName) {
    console.error("--local-call requires <toolName> <jsonArgs>.");
    process.exit(2);
  }
  let jsonArgs;
  try {
    jsonArgs = JSON.parse(rawJsonArgs);
  } catch {
    console.error("--local-call jsonArgs must be valid JSON.");
    process.exit(2);
  }
  return { toolName, jsonArgs };
}

function runLocalCall({ toolName, jsonArgs }) {
  if (!LOCAL_CALL_ALLOWED_TOOLS.has(toolName)) {
    console.error(`--local-call tool is not allowed: ${sanitizeLogValue(toolName)}`);
    process.exit(2);
  }
  const result = callTool({ name: toolName, arguments: jsonArgs });
  console.log(JSON.stringify(result, null, 2));
}

function printUsage() {
  console.error("Missing XiaoZhi MCP token.");
  console.error("Usage:");
  console.error(`  ${TOKEN_ENV}=<token> node bridge.mjs`);
  console.error("Optional:");
  console.error(`  ${BASE_URL_ENV}=wss://api.XiaoZhi.me/mcp/`);
  console.error(`  ${DRY_RUN_ENV}=1 node bridge.mjs`);
  console.error(`  ${DEBUG_ENV}=1 node bridge.mjs`);
  console.error(`  ${PLAN_STATE_FILE_ENV}=/absolute/path/to/plan_status.json`);
  console.error("  node bridge.mjs --debug");
  console.error("  node bridge.mjs --local-call get_plan_status '{}'");
  console.error("Never commit or paste real tokens into source files or logs.");
}

function buildEndpointUrl(rawBaseUrl, rawToken) {
  const url = new URL(rawBaseUrl);
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("base URL must use ws:// or wss://");
  }
  url.searchParams.set("token", rawToken);
  return url;
}

function safeUrlForLog(url) {
  return `${url.protocol}//${url.host}${url.pathname}${url.search ? "?<redacted>" : ""}`;
}

async function messageDataToText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (data && typeof data.text === "function") return data.text();
  return String(data ?? "");
}

async function handleIncomingMessage(socket, text) {
  let request;
  try {
    request = JSON.parse(text);
  } catch {
    sendJson(socket, makeError(null, -32700, "Parse error"));
    return;
  }

  if (Array.isArray(request)) {
    const responses = [];
    for (const item of request) {
      debugLogIncoming(item);
      const response = handleJsonRpcRequest(item);
      if (response) responses.push(response);
    }
    if (responses.length > 0) sendJson(socket, responses);
    return;
  }

  debugLogIncoming(request);
  const response = handleJsonRpcRequest(request);
  if (response) sendJson(socket, response);
}

function handleJsonRpcRequest(request) {
  if (!request || typeof request !== "object" || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    const id = request && Object.hasOwn(request, "id") ? request.id : null;
    return makeError(id, -32600, "Invalid Request");
  }

  const hasId = Object.hasOwn(request, "id");
  if (!hasId) {
    if (!debugEnabled) console.log(`Ignoring notification: ${sanitizeLogValue(request.method)}`);
    return null;
  }

  try {
    switch (request.method) {
      case "initialize":
        return makeResult(request.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "xiaozhi-mcp-bridge", version: "0.1.0" },
        });
      case "ping":
        return makeResult(request.id, { ok: true, message: "pong" });
      case "tools/list":
        return makeResult(request.id, { tools });
      case "tools/call":
        return makeResult(request.id, callTool(request.params));
      default:
        return makeError(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    const code = error instanceof ToolInputError ? -32602 : -32000;
    return makeError(request.id, code, error.message);
  }
}

function callTool(params = {}) {
  const name = params.name;
  const toolArgs = params.arguments || {};

  switch (name) {
    case "ping":
      return makeToolTextResult("pong");
    case "echo": {
      if (typeof toolArgs.text !== "string") {
        return makeToolTextResult("echo requires arguments.text to be a string", true);
      }
      if ([...toolArgs.text].length > ECHO_MAX_CHARS) {
        return makeToolTextResult(`echo text must be <= ${ECHO_MAX_CHARS} characters`, true);
      }
      return makeToolTextResult(toolArgs.text);
    }
    case "get_time":
      return makeToolTextResult(JSON.stringify(getShanghaiTime()));
    case "get_plan_status":
      if (!isEmptyObject(toolArgs)) return makeToolTextResult(JSON.stringify({ ok: false, error: "get_plan_status does not accept arguments" }), true);
      return makeToolTextResult(JSON.stringify(getPlanStatus()));
    case "get_latest_completion_event":
      if (!isEmptyObject(toolArgs)) return makeToolTextResult(JSON.stringify({ ok: false, error: "get_latest_completion_event does not accept arguments" }), true);
      return makeToolTextResult(JSON.stringify(getLatestCompletionEvent()));
    default:
      throw new ToolInputError(`Unknown tool: ${String(name)}`);
  }
}

function isEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function getShanghaiTime() {
  const now = new Date();
  const iso = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now).replace(" ", "T") + "+08:00";

  return {
    iso,
    unix_ms: now.getTime(),
    timezone: "Asia/Shanghai",
  };
}

function resolvePlanStateFile() {
  const envFile = process.env[PLAN_STATE_FILE_ENV];
  if (!envFile) return { ok: true, path: DEFAULT_PLAN_STATE_FILE };
  if (!path.isAbsolute(envFile)) return { ok: false, reason: "env_path_must_be_absolute" };
  if (path.extname(envFile).toLowerCase() !== ".json") return { ok: false, reason: "env_path_must_be_json" };
  return { ok: true, path: envFile };
}

function readStateSnapshot() {
  const resolved = resolvePlanStateFile();
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  let stat;
  try {
    stat = fs.statSync(resolved.path);
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, reason: "file_not_found" };
    return { ok: false, reason: "stat_failed" };
  }

  if (!stat.isFile()) return { ok: false, reason: "not_a_file" };
  if (stat.size > PLAN_STATE_MAX_BYTES) return { ok: false, reason: "file_too_large" };

  let raw;
  try {
    raw = fs.readFileSync(resolved.path, "utf-8");
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  try {
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return { ok: false, reason: "invalid_schema" };
    }
    return { ok: true, state };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function getPlanStatus() {
  const snapshot = readStateSnapshot();
  if (!snapshot.ok) return { state: "state_unavailable", reason: snapshot.reason };

  const source = snapshot.state.plan && typeof snapshot.state.plan === "object"
    ? snapshot.state.plan
    : snapshot.state;

  return {
    state: "ok",
    plan: projectPlanSummary(source),
  };
}

function getLatestCompletionEvent() {
  const snapshot = readStateSnapshot();
  if (!snapshot.ok) {
    return {
      state: "state_unavailable",
      should_celebrate: false,
      event_id: null,
      event_type: "",
      plan_id: "",
      plan_title: "",
      task_id: null,
      task_title: "",
      completed_at: null,
      ttl_seconds: DEFAULT_EVENT_TTL_SECONDS,
      age_seconds: null,
      expires_in_seconds: 0,
      reason: snapshot.reason,
    };
  }

  const event = snapshot.state.latest_completion_event;
  return projectCompletionEvent(event && typeof event === "object" && !Array.isArray(event) ? event : null);
}

function projectPlanSummary(plan) {
  const source = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : {};
  const tasks = Array.isArray(source.tasks) ? source.tasks.map(projectTask) : [];
  const completed = tasks.filter((task) => isCompletedStatus(task.status)).length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress" || task.status === "active").length;

  return {
    plan_id: safeString(source.plan_id ?? source.id),
    plan_title: safeString(source.plan_title ?? source.title),
    plan_status: safeString(source.plan_status ?? source.status ?? "unknown"),
    total_tasks: safeNumber(source.total_tasks, tasks.length),
    completed_tasks: safeNumber(source.completed_tasks, completed),
    blocked_tasks: safeNumber(source.blocked_tasks, blocked),
    in_progress_tasks: safeNumber(source.in_progress_tasks, inProgress),
    progress_text: safeString(source.progress_text || `${completed}/${tasks.length} completed`),
    tasks,
  };
}

function projectTask(task) {
  const source = task && typeof task === "object" && !Array.isArray(task) ? task : {};
  return {
    id: safeScalar(source.id),
    title: safeString(source.title),
    status: safeString(source.status),
  };
}

function projectCompletionEvent(event) {
  const source = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  const ttlSeconds = normalizeTtlSeconds(source.ttl_seconds);
  const timing = computeCompletionEventTiming(source.event_id, source.completed_at, ttlSeconds);

  return {
    state: "ok",
    should_celebrate: timing.shouldCelebrate,
    event_id: source.event_id ? safeString(source.event_id) : null,
    event_type: safeString(source.event_type),
    plan_id: safeString(source.plan_id),
    plan_title: safeString(source.plan_title),
    task_id: safeScalar(source.task_id),
    task_title: safeString(source.task_title),
    completed_at: source.completed_at ? safeString(source.completed_at) : null,
    ttl_seconds: ttlSeconds,
    age_seconds: timing.ageSeconds,
    expires_in_seconds: timing.expiresInSeconds,
  };
}

function computeCompletionEventTiming(eventId, completedAt, ttlSeconds) {
  if (!eventId || typeof completedAt !== "string") {
    return { shouldCelebrate: false, ageSeconds: null, expiresInSeconds: 0 };
  }

  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs)) {
    return { shouldCelebrate: false, ageSeconds: null, expiresInSeconds: 0 };
  }

  const ageSeconds = Math.floor((Date.now() - completedMs) / 1000);
  if (ageSeconds < 0) {
    return { shouldCelebrate: false, ageSeconds, expiresInSeconds: 0 };
  }

  const expiresInSeconds = Math.max(0, ttlSeconds - ageSeconds);
  return {
    shouldCelebrate: expiresInSeconds > 0,
    ageSeconds,
    expiresInSeconds,
  };
}

function normalizeTtlSeconds(value) {
  if (!Number.isFinite(value)) return DEFAULT_EVENT_TTL_SECONDS;
  return Math.max(0, Math.floor(value));
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function safeStringOrNull(value) {
  const text = safeString(value);
  return text ? text : null;
}

function safeScalar(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function safeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function isCompletedStatus(status) {
  return status === "done" || status === "completed";
}

function makeResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeToolTextResult(text, isError = false) {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    debugLogOutgoing(payload);
    socket.send(JSON.stringify(payload));
  }
}

function debugLogIncoming(message) {
  if (!debugEnabled) return;
  if (!message || typeof message !== "object") {
    console.log("[mcp-debug] <- invalid-json-rpc-message");
    return;
  }

  const method = typeof message.method === "string" ? message.method : "<none>";
  const hasId = Object.hasOwn(message, "id");
  const parts = [
    "[mcp-debug] <-",
    `method=${sanitizeLogValue(method)}`,
    `id=${hasId ? sanitizeLogValue(formatJsonValueForLog(message.id)) : "<none>"}`,
    `notification=${!hasId}`,
  ];

  if (method === "tools/call") {
    const toolName = message.params && typeof message.params === "object" ? message.params.name : undefined;
    parts.push(`tool=${sanitizeLogValue(toolName ?? "<unknown>")}`);
  }

  console.log(parts.join(" "));
}

function debugLogOutgoing(payload) {
  if (!debugEnabled) return;
  const messages = Array.isArray(payload) ? payload : [payload];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      console.log("[mcp-debug] -> invalid-json-rpc-message");
      continue;
    }

    const hasError = Object.hasOwn(message, "error");
    const parts = [
      "[mcp-debug] ->",
      `id=${sanitizeLogValue(formatJsonValueForLog(message.id ?? null))}`,
      hasError ? "error" : "result",
    ];

    if (!hasError && message.result && Array.isArray(message.result.tools)) {
      parts.push(`tools count=${message.result.tools.length}`);
    }

    console.log(parts.join(" "));
  }
}

function formatJsonValueForLog(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeLogValue(value) {
  const text = String(value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "?");
  if (text.length <= LOG_VALUE_MAX_CHARS) return text;
  return `${text.slice(0, LOG_VALUE_MAX_CHARS)}...<truncated>`;
}

function shutdown(signal) {
  console.log(`Received ${signal}; closing bridge.`);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(1000, "shutdown");
  }
  setTimeout(() => process.exit(0), 500).unref();
}

class ToolInputError extends Error {}
