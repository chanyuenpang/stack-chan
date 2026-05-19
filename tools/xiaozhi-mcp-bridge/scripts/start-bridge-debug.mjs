#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const TOKEN_ENV = "XIAOZHI_MCP_TOKEN";
const DEBUG_ENV = "XIAOZHI_MCP_DEBUG";
const BRIDGE_FILE = "bridge.mjs";

const cwd = process.cwd();
const bridgePath = path.join(cwd, BRIDGE_FILE);

console.log("XiaoZhi MCP bridge safe debug launcher");
console.log(`Working directory: ${cwd}`);

if (!fs.existsSync(bridgePath) || !fs.statSync(bridgePath).isFile()) {
  console.error(`Missing ${BRIDGE_FILE} in current directory.`);
  console.error("Please run this from StackChan/tools/xiaozhi-mcp-bridge, for example:");
  console.error("  cd StackChan/tools/xiaozhi-mcp-bridge");
  console.error("  npm run start:debug");
  process.exit(1);
}

const token = process.env[TOKEN_ENV];
const tokenSet = typeof token === "string" && token.length > 0;
console.log(`${TOKEN_ENV}: ${tokenSet ? `set (${token.length} chars)` : "unset"}`);
console.log(`${DEBUG_ENV}: ${process.env[DEBUG_ENV] === undefined ? "will set to 1 for child bridge" : "already set"}`);

runLocalCompletionEventCheck();

if (!tokenSet) {
  console.error(`Refusing to start bridge because ${TOKEN_ENV} is unset.`);
  console.error("Export the token in this same terminal, then run again:");
  console.error(`  export ${TOKEN_ENV}='<new-test-token>'`);
  console.error("  npm run start:debug");
  console.error("Do not paste, screenshot, commit, or send the real token.");
  process.exit(1);
}

console.log("Starting bridge in foreground. Press Ctrl+C to stop.");

const childEnv = {
  ...process.env,
  [DEBUG_ENV]: process.env[DEBUG_ENV] ?? "1",
};

const child = spawn(process.execPath, [BRIDGE_FILE], {
  cwd,
  env: childEnv,
  stdio: "inherit",
});

let forwardingSignal = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.exitCode !== null || forwardingSignal) return;
    forwardingSignal = true;
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Failed to start bridge: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

function runLocalCompletionEventCheck() {
  const result = spawnSync(process.execPath, [BRIDGE_FILE, "--local-call", "get_latest_completion_event", "{}"], {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const summary = summarizeLocalCall(result);
  console.log(`Local completion event check: ${summary}`);
}

function summarizeLocalCall(result) {
  if (result.error) {
    return `failed (${result.error.message})`;
  }
  if (result.status !== 0) {
    return `failed (exit=${result.status}, isError=true)`;
  }

  try {
    const toolResult = JSON.parse(result.stdout || "{}");
    const isError = Boolean(toolResult.isError);
    const text = toolResult.content?.find((item) => item?.type === "text")?.text;
    const payload = typeof text === "string" ? JSON.parse(text) : {};
    const shouldCelebrate = payload.should_celebrate === true;
    const state = typeof payload.state === "string" ? payload.state : "unknown";
    return `ok (state=${state}, should_celebrate=${shouldCelebrate}, isError=${isError})`;
  } catch {
    return "completed, but summary parse failed (isError=unknown)";
  }
}
