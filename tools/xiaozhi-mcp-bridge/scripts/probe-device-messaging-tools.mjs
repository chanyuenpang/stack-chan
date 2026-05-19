#!/usr/bin/env node

const LIST_ENDPOINT = "https://xiaozhi.me/api/messaging/device/tools/list";
const CALL_ENDPOINT = "https://xiaozhi.me/api/messaging/device/tools/call";
const TOKEN_ENV = "XIAOZHI_MESSAGING_TOKEN";
const URL_ENV = "XIAOZHI_MESSAGING_URL";
const DEFAULT_FILTER_TERMS = ["audio", "tts", "speak", "play", "sound", "reminder"];
const SAFE_READ_ONLY_PREFIXES = ["get", "list", "read", "query", "search", "describe", "inspect", "status"];
const REQUEST_TIMEOUT_MS = 20_000;

function printUsage() {
  console.log(`Usage:
  node scripts/probe-device-messaging-tools.mjs --list
  node scripts/probe-device-messaging-tools.mjs --filter audio,tts,speak,play,sound,reminder
  node scripts/probe-device-messaging-tools.mjs --dry-run
  node scripts/probe-device-messaging-tools.mjs --call <toolName> --args '<json>' [--allow-call]

Environment:
  ${TOKEN_ENV}=<assets-generator messaging token>
  ${URL_ENV}=<https://xiaozhi.me/tools/assets-generator/?token=...>

Token priority:
  1. ${TOKEN_ENV}
  2. token query parameter from ${URL_ENV}

Safety:
  - Token is read only from environment variables; never pass it on the command line.
  - Default operation is tools/list only.
  - tools/call is blocked unless the tool name looks read-only or --allow-call is set.
  - Token content is never printed; only source (env/url/unset) and length are shown.`);
}

function parseArgs(argv) {
  const options = {
    list: false,
    dryRun: false,
    help: false,
    allowCall: false,
    filterTerms: [...DEFAULT_FILTER_TERMS],
    callTool: null,
    callArgsText: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--allow-call") {
      options.allowCall = true;
    } else if (arg === "--filter") {
      const value = argv[++i];
      if (!value) throw new Error("--filter requires a comma-separated value");
      options.filterTerms = parseFilterTerms(value);
      options.list = true;
    } else if (arg.startsWith("--filter=")) {
      options.filterTerms = parseFilterTerms(arg.slice("--filter=".length));
      options.list = true;
    } else if (arg === "--call") {
      const value = argv[++i];
      if (!value) throw new Error("--call requires a tool name");
      options.callTool = value;
    } else if (arg.startsWith("--call=")) {
      const value = arg.slice("--call=".length);
      if (!value) throw new Error("--call requires a tool name");
      options.callTool = value;
    } else if (arg === "--args") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--args requires a JSON value");
      options.callArgsText = value;
    } else if (arg.startsWith("--args=")) {
      options.callArgsText = arg.slice("--args=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.list && !options.callTool) {
    options.list = true;
  }

  return options;
}

function parseFilterTerms(value) {
  const terms = value
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) throw new Error("--filter must include at least one non-empty term");
  return terms;
}

function getTokenStatus() {
  const envToken = process.env[TOKEN_ENV] ?? "";
  if (envToken.length > 0) {
    return {
      token: envToken,
      source: "env",
      isSet: true,
      length: envToken.length,
      urlError: null,
    };
  }

  const { token: urlToken, error: urlError } = extractTokenFromMessagingUrl(process.env[URL_ENV]);
  if (urlToken.length > 0) {
    return {
      token: urlToken,
      source: "url",
      isSet: true,
      length: urlToken.length,
      urlError,
    };
  }

  return {
    token: "",
    source: "unset",
    isSet: false,
    length: 0,
    urlError,
  };
}

function extractTokenFromMessagingUrl(rawUrl) {
  if (!rawUrl) return { token: "", error: null };
  try {
    const parsed = new URL(rawUrl);
    return { token: parsed.searchParams.get("token") ?? "", error: null };
  } catch (error) {
    return { token: "", error: `${URL_ENV} is not a valid URL: ${error.message}` };
  }
}

function printTokenStatus({ source, isSet, length, urlError }) {
  console.log(`Token source: ${source} (${isSet ? "set" : "unset"}, length=${length})`);
  if (urlError) console.log(`URL token import: ignored (${urlError})`);
}

function parseJsonArgs(text) {
  if (text === null || text === undefined) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("args JSON must be an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid --args JSON: ${error.message}`);
  }
}

function isReadOnlyToolName(name) {
  const normalized = String(name).toLowerCase();
  return SAFE_READ_ONLY_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}-`));
}

function assertCallAllowed(toolName, allowCall) {
  if (allowCall || isReadOnlyToolName(toolName)) return;
  throw new Error(
    `Refusing to call possibly state-changing tool "${toolName}". `
      + `Use --allow-call only after manually verifying the tool is safe. `
      + `Never auto-call device-control tools such as set_led/head/reminder/audio/play.`
  );
}

function makeCandidateMatcher(filterTerms) {
  return (tool) => {
    const schema = getToolInputSchema(tool);
    const haystack = [tool.name, tool.description, JSON.stringify(schema ?? {})]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return filterTerms.some((term) => haystack.includes(term));
  };
}

function getToolInputSchema(tool) {
  return tool?.inputSchema ?? tool?.input_schema ?? tool?.parameters ?? tool?.schema ?? null;
}

function summarizeInputSchema(schema) {
  if (!schema || typeof schema !== "object") return "none";
  const type = typeof schema.type === "string" ? schema.type : "object";
  const properties = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  const required = Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : [];
  const parts = [`type=${type}`];
  if (properties.length > 0) parts.push(`properties=${properties.slice(0, 12).join(",")}${properties.length > 12 ? ",…" : ""}`);
  if (required.length > 0) parts.push(`required=${required.slice(0, 12).join(",")}${required.length > 12 ? ",…" : ""}`);
  return parts.join("; ");
}

function normalizeTools(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.tools)) return payload.tools;
  if (Array.isArray(payload?.data?.tools)) return payload.data.tools;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function postJson(endpoint, token, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    if (text.trim().length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        const preview = text.replace(/[\r\n\t]+/g, " ").slice(0, 240);
        throw new Error(`Non-JSON response from ${endpoint}: HTTP ${response.status}; body preview=${JSON.stringify(preview)}`);
      }
    }

    if (!response.ok) {
      const detail = extractErrorDetail(payload);
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication/authorization failed: HTTP ${response.status}${detail ? `; ${detail}` : ""}. Check that ${TOKEN_ENV} is a messaging token, not an MCP endpoint token.`);
      }
      throw new Error(`Request failed: HTTP ${response.status}${detail ? `; ${detail}` : ""}`);
    }

    return payload ?? {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms; device/service may be offline or unreachable`);
    }
    if (error instanceof TypeError) {
      throw new Error(`Network request failed; device/service may be offline or unreachable: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractErrorDetail(payload) {
  if (!payload || typeof payload !== "object") return "";
  for (const key of ["message", "error", "detail", "msg"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  if (payload.data && typeof payload.data === "object") {
    return extractErrorDetail(payload.data);
  }
  return "";
}

function printDryRun(options, tokenStatus) {
  printTokenStatus(tokenStatus);
  if (options.callTool) {
    console.log(`Dry run: would POST ${CALL_ENDPOINT}`);
    console.log(`Tool: ${options.callTool}`);
    console.log(`Call allowed by flag/name: ${options.allowCall || isReadOnlyToolName(options.callTool) ? "yes" : "no"}`);
  } else {
    console.log(`Dry run: would POST ${LIST_ENDPOINT}`);
    console.log(`Filter terms: ${options.filterTerms.join(",")}`);
  }
  console.log("No network request was made.");
}

function printTools(tools, filterTerms) {
  const isCandidate = makeCandidateMatcher(filterTerms);
  console.log(`Tools returned: ${tools.length}`);
  if (tools.length === 0) {
    console.log("No tools found in response. Raw response shape may differ from expected { tools: [...] }.");
    return;
  }

  for (const [index, tool] of tools.entries()) {
    const name = typeof tool?.name === "string" ? tool.name : `(unnamed-${index + 1})`;
    const description = typeof tool?.description === "string" && tool.description.trim() ? tool.description.trim() : "(no description)";
    const candidate = isCandidate(tool);
    console.log(`\n${index + 1}. ${candidate ? "[CANDIDATE_AUDIO] " : ""}${name}`);
    console.log(`   description: ${description}`);
    console.log(`   inputSchema: ${summarizeInputSchema(getToolInputSchema(tool))}`);
  }

  const candidates = tools.filter(isCandidate);
  console.log(`\nCandidate active-audio tools matched [${filterTerms.join(", ")}]: ${candidates.length}`);
  if (candidates.length > 0) {
    console.log(candidates.map((tool) => `- ${tool.name ?? "(unnamed)"}`).join("\n"));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const tokenStatus = getTokenStatus();

  if (options.dryRun) {
    printDryRun(options, tokenStatus);
    return;
  }

  printTokenStatus(tokenStatus);
  if (!tokenStatus.isSet) {
    throw new Error(`${TOKEN_ENV} is unset and ${URL_ENV} does not contain a token query parameter. Export the assets-generator messaging token or URL first. Do not pass tokens as CLI arguments.`);
  }

  if (options.callTool) {
    assertCallAllowed(options.callTool, options.allowCall);
    const args = parseJsonArgs(options.callArgsText);
    console.log(`POST ${CALL_ENDPOINT}`);
    console.log(`Calling tool: ${options.callTool}`);
    const payload = await postJson(CALL_ENDPOINT, tokenStatus.token, {
      name: options.callTool,
      toolName: options.callTool,
      arguments: args,
      args,
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`POST ${LIST_ENDPOINT}`);
  const payload = await postJson(LIST_ENDPOINT, tokenStatus.token, {});
  const tools = normalizeTools(payload);
  printTools(tools, options.filterTerms);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
