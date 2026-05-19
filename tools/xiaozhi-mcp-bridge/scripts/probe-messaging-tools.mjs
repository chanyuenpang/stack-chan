#!/usr/bin/env node

const TOKEN_ENV = "XIAOZHI_MESSAGING_TOKEN";
const BASE_URL_ENV = "XIAOZHI_MESSAGING_BASE_URL";
const DEFAULT_BASE_URL = "https://xiaozhi.me";
const CANDIDATE_KEYWORDS = ["speak", "tts", "audio", "play", "sound", "speaker", "reminder", "notification", "broadcast"];
const DANGEROUS_TOOL_PATTERNS = [
  /(^|[._-])set([._-]|$)/i,
  /(^|[._-])create([._-]|$)/i,
  /(^|[._-])delete([._-]|$)/i,
  /(^|[._-])update([._-]|$)/i,
  /(^|[._-])send([._-]|$)/i,
  /(^|[._-])play([._-]|$)/i,
  /(^|[._-])speak([._-]|$)/i,
  /(^|[._-])tts([._-]|$)/i,
  /(^|[._-])audio([._-]|$)/i,
  /(^|[._-])head([._-]|$)/i,
  /(^|[._-])led([._-]|$)/i,
  /(^|[._-])reminder([._-]|$)/i,
  /(^|[._-])notification([._-]|$)/i,
  /(^|[._-])broadcast([._-]|$)/i,
  /(^|[._-])reboot([._-]|$)/i,
  /(^|[._-])flash([._-]|$)/i,
  /(^|[._-])ota([._-]|$)/i,
];
const SAFE_READONLY_TOOL_PATTERNS = [
  /^self\.(get_|screen\.get_|device\.get_)/i,
  /(^|[._-])(get|list|read|status|info)([._-]|$)/i,
];

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const stdinToken = options.tokenFromStdin ? await readTokenFromStdin() : null;
  const envToken = process.env[TOKEN_ENV] || null;
  const token = stdinToken || envToken;
  const tokenSource = stdinToken ? "stdin" : envToken ? "env" : "none";

  if (options.dryRun) {
    printDryRun(options, { token, tokenSource });
    process.exit(0);
  }

  if (options.callTool) {
    assertSafeReadonlyToolName(options.callTool);
  }

  if (!token) {
    console.log(JSON.stringify({
      ok: true,
      mode: "no_token_dry_run",
      message: `${TOKEN_ENV} is not set and no token was extracted from stdin; no network request was made. Export a messaging token or pipe URL/text with --token-from-stdin, then rerun without --dry-run to call tools/list.`,
      token_source: tokenSource,
      token_present: false,
      token_value_printed: false,
      endpoints: endpointsFor(options.baseUrl),
      candidate_keywords: CANDIDATE_KEYWORDS,
    }, null, 2));
    process.exit(0);
  }

  const tools = await listTools({ baseUrl: options.baseUrl, token });
  printToolReport(tools);

  if (options.callTool) {
    const result = await callTool({
      baseUrl: options.baseUrl,
      token,
      toolName: options.callTool,
      toolArgs: options.callArgs,
    });
    console.log(JSON.stringify({ ok: true, call_result: sanitizeValue(result) }, null, 2));
  }
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error("unexpected_error");
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    dryRun: true,
    baseUrl: process.env[BASE_URL_ENV] || DEFAULT_BASE_URL,
    callTool: null,
    callArgs: {},
    tokenFromStdin: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dry-run":
      case "--list-only":
        parsed.dryRun = true;
        break;
      case "--live":
        parsed.dryRun = false;
        break;
      case "--base-url":
        parsed.baseUrl = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--token-from-stdin":
        parsed.tokenFromStdin = true;
        break;
      case "--call":
        parsed.callTool = requireValue(argv, index, arg);
        parsed.dryRun = false;
        index += 1;
        break;
      case "--args":
        parsed.callArgs = parseJsonObject(requireValue(argv, index, arg), "--args");
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new CliError(`unknown_argument ${safeText(arg)}`, 2);
    }
  }

  parsed.baseUrl = normalizeBaseUrl(parsed.baseUrl);
  if (parsed.callTool && Object.keys(parsed.callArgs).length === 0) {
    parsed.callArgs = {};
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new CliError(`missing_argument_value ${flag}`, 2);
  return value;
}

function parseJsonObject(raw, label) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return parsed;
  } catch {
    throw new CliError(`${label} must be a JSON object`, 2);
  }
}

function normalizeBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`${BASE_URL_ENV}/--base-url must be a valid http(s) URL`, 2);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CliError(`${BASE_URL_ENV}/--base-url must use http:// or https://`, 2);
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function endpointsFor(baseUrl) {
  return {
    tools_list: `${baseUrl}/api/messaging/device/tools/list`,
    tools_call: `${baseUrl}/api/messaging/device/tools/call`,
  };
}

function printDryRun(options, tokenInfo = {}) {
  const token = tokenInfo.token || null;
  console.log(JSON.stringify({
    ok: true,
    mode: "dry_run",
    network: false,
    token_env: TOKEN_ENV,
    token_source: tokenInfo.tokenSource || "none",
    token_present: Boolean(token),
    token_length: token ? token.length : 0,
    token_value_printed: false,
    token_from_stdin_requested: options.tokenFromStdin,
    endpoints: endpointsFor(options.baseUrl),
    candidate_keywords: CANDIDATE_KEYWORDS,
    default_behavior: "Use --live with XIAOZHI_MESSAGING_TOKEN set or --token-from-stdin to call tools/list. Use --call only for explicitly selected safe read-only tools.",
  }, null, 2));
}

async function readTokenFromStdin() {
  const input = await readAllStdin();
  if (!input.trim()) return null;
  return extractMessagingToken(input);
}

async function readAllStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const size = chunks.reduce((total, item) => total + item.length, 0);
    if (size > 16 * 1024) throw new CliError("stdin_too_large max 16KB", 2);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractMessagingToken(input) {
  const text = input.trim();
  const urlMatches = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
  for (const candidate of [text, ...urlMatches]) {
    try {
      const url = new URL(candidate);
      const value = firstNonEmpty(
        url.searchParams.get("token"),
        url.searchParams.get("messaging_token"),
        url.searchParams.get("messagingToken"),
        url.searchParams.get("access_token"),
      );
      if (value) return value;
    } catch {
      // Not a URL; continue with text patterns below.
    }
  }

  const bearer = text.match(/\bBearer\s+([A-Za-z0-9._~+\/-]{8,})/i);
  if (bearer) return bearer[1];

  const keyValue = text.match(/\b(?:token|messaging_token|messagingToken|access_token)\s*[=:]\s*([A-Za-z0-9._~+\/-]{8,})/i);
  if (keyValue) return keyValue[1];

  if (/^[A-Za-z0-9._~+\/-]{8,}$/.test(text)) return text;
  return null;
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) || null;
}

async function listTools({ baseUrl, token }) {
  const response = await fetchJson(`${baseUrl}/api/messaging/device/tools/list`, { token, body: {} });
  return extractTools(response);
}

async function callTool({ baseUrl, token, toolName, toolArgs }) {
  return fetchJson(`${baseUrl}/api/messaging/device/tools/call`, {
    token,
    body: { name: toolName, arguments: toolArgs },
  });
}

async function fetchJson(url, { token, body }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { non_json_response: text.slice(0, 500) };
  }

  if (!response.ok) {
    return { ok: false, http_status: response.status, response: sanitizeValue(parsed) };
  }
  return parsed;
}

function extractTools(payload) {
  const candidates = [
    payload?.tools,
    payload?.data?.tools,
    payload?.result?.tools,
    payload?.data,
    payload?.result,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function printToolReport(tools) {
  const projected = tools.map(projectTool);
  const candidates = projected.filter((tool) => tool.candidate_keywords.length > 0);
  console.log(JSON.stringify({
    ok: true,
    tool_count: projected.length,
    candidate_count: candidates.length,
    candidate_keywords: CANDIDATE_KEYWORDS,
    tools: projected,
    candidates,
  }, null, 2));
}

function projectTool(tool) {
  const name = safeString(tool?.name ?? tool?.tool ?? tool?.id);
  const description = summarizeText(tool?.description ?? tool?.desc ?? tool?.title ?? "");
  const input = summarizeSchema(tool?.inputSchema ?? tool?.input_schema ?? tool?.parameters ?? tool?.params);
  const haystack = `${name} ${description} ${JSON.stringify(input)}`.toLowerCase();
  const candidateKeywords = CANDIDATE_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  return {
    name,
    description,
    input_summary: input,
    candidate_keywords: candidateKeywords,
    safe_readonly_candidate: isSafeReadonlyToolName(name),
  };
}

function summarizeSchema(schema) {
  if (!schema || typeof schema !== "object") return {};
  const properties = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties).slice(0, 20) : [];
  const required = Array.isArray(schema.required) ? schema.required.slice(0, 20).map(String) : [];
  return {
    type: safeString(schema.type || "object"),
    properties,
    required,
  };
}

function assertSafeReadonlyToolName(toolName) {
  if (!isSafeReadonlyToolName(toolName)) {
    throw new CliError(`refusing_to_call_non_readonly_tool ${safeText(toolName)}; this probe only allows explicit safe read-only get/list/read/status/info tools`, 2);
  }
}

function isSafeReadonlyToolName(toolName) {
  const name = safeString(toolName);
  if (!name) return false;
  if (DANGEROUS_TOOL_PATTERNS.some((pattern) => pattern.test(name))) return false;
  return SAFE_READONLY_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token|authorization|secret|session|cookie/i.test(key)) {
      out[key] = "<redacted>";
    } else if (typeof raw === "string") {
      out[key] = raw.length > 1000 ? `${raw.slice(0, 1000)}...<truncated>` : raw;
    } else {
      out[key] = sanitizeValue(raw);
    }
  }
  return out;
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function summarizeText(value) {
  const text = safeString(value).replace(/[\r\n\t]/g, " ").trim();
  return text.length > 240 ? `${text.slice(0, 240)}...<truncated>` : text;
}

function safeText(value) {
  return safeString(value).replace(/[\r\n\t]/g, " ").slice(0, 120);
}

function printUsage() {
  console.log(`Usage:
  node scripts/probe-messaging-tools.mjs --dry-run
  printf '%s' '<url-or-text>' | node scripts/probe-messaging-tools.mjs --token-from-stdin --dry-run
  printf '%s' '<url-or-text>' | node scripts/probe-messaging-tools.mjs --token-from-stdin --live
  XIAOZHI_MESSAGING_TOKEN='<token>' node scripts/probe-messaging-tools.mjs --live
  XIAOZHI_MESSAGING_TOKEN='<token>' node scripts/probe-messaging-tools.mjs --call self.get_device_status

Options:
  --dry-run, --list-only   Do not connect. This is the default.
  --live                   With ${TOKEN_ENV} set, POST tools/list only.
  --call <toolName>        Explicitly call a safe read-only get/list/read/status/info tool.
  --args '{...}'           JSON object arguments for --call. Default {}.
  --base-url <url>         Default ${DEFAULT_BASE_URL}. Can also use ${BASE_URL_ENV}.
  --token-from-stdin       Extract token from piped URL/text. Never prints or saves token.

Safety:
  Token is read only from ${TOKEN_ENV}; it is never printed, saved, or written to files.
  The script never auto-calls action tools such as led/head/reminder/audio/play/speak/tts/broadcast.
`);
}
