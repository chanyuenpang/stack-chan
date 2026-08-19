#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStackchanMcpServer } from "../src/mcp.mjs";
import { CodexVoiceTranscriptSource } from "../src/codex-voice-transcript-source.mjs";
import { XiaozhiDockRuntime } from "../src/xiaozhi-runtime.mjs";
import { XiaozhiTranscriptPresenter } from "../src/xiaozhi-transcript-presenter.mjs";
import { XiaozhiWebSocketServer } from "../src/xiaozhi-websocket-server.mjs";
import { XiaozhiLocalAdmin } from "../src/xiaozhi-local-admin.mjs";

const args = process.argv.slice(2);
const standalone = args.includes("--standalone");
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const integer = (name, fallback) => {
  const parsed = Number(value(name, fallback));
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

const token = value("--token", process.env.STACKCHAN_XIAOZHI_TOKEN);
const expectedDeviceId = value("--device-id", process.env.STACKCHAN_DEVICE_ID);
const advertiseHost = value("--advertise-host", process.env.STACKCHAN_DOCK_HOST);
const codexPid = integer("--codex-pid", process.env.CODEX_ROOT_PID);
const binaryPath = value("--broker", process.env.STACKCHAN_WASAPI_BROKER);
const websocketPort = integer("--websocket-port", "8765");
const bootstrapPort = integer("--bootstrap-port", "8766");
const renderDevice = value("--render-device", "CABLE Input");

if (!token || !expectedDeviceId || !advertiseHost || !Number.isInteger(codexPid) || codexPid <= 0 ||
    !binaryPath || !Number.isInteger(websocketPort) || websocketPort < 1 || websocketPort > 65_535 ||
    !Number.isInteger(bootstrapPort) || bootstrapPort < 1 || bootstrapPort > 65_535) {
  throw new Error(
    "Usage: stackchan-xiaozhi-dock --token TOKEN --device-id MAC --advertise-host HOST " +
    "--codex-pid PID --broker PATH [--websocket-port 8765] [--bootstrap-port 8766] " +
    "[--render-device 'CABLE Input'] [--standalone]",
  );
}

const server = new XiaozhiWebSocketServer({ token, expectedDeviceId });
const transcriptPresenter = new XiaozhiTranscriptPresenter(server);
const runtime = new XiaozhiDockRuntime({
  token,
  expectedDeviceId,
  advertiseHost,
  websocketPort,
  bootstrapPort,
  binaryPath,
  codexPid,
  renderDevice,
  server,
  subtitlePresenter: transcriptPresenter,
});
const transcriptSource = new CodexVoiceTranscriptSource({ databasePath: process.env.CODEX_LOGS_DATABASE || undefined });
const consoleStatus = { runtime: "starting", voice: "idle", subtitle: "idle", last_error: null };
runtime.on("authenticated", ({ deviceId }) => { consoleStatus.runtime = "connected"; consoleStatus.last_error = null; process.stderr.write(`StackChan XiaoZhi authenticated device=${deviceId}\n`); });
runtime.on("disconnected", ({ code, reason }) => { consoleStatus.runtime = "disconnected"; process.stderr.write(`StackChan XiaoZhi disconnected code=${code} reason=${reason}\n`); });
runtime.on("speaking", (speaking) => { consoleStatus.voice = speaking ? "speaking" : "idle"; process.stderr.write(`StackChan half_duplex_speaking=${speaking}\n`); });
runtime.on("subtitleWaiting", ({ waitMs }) => process.stderr.write(`StackChan subtitle waiting for text max_ms=${waitMs}\n`));
runtime.on("subtitleFailOpen", ({ waitMs, bufferedPackets }) => process.stderr.write(`StackChan subtitle fail-open wait_ms=${waitMs} buffered_packets=${bufferedPackets}\n`));
runtime.on("subtitleLate", () => process.stderr.write("StackChan subtitle arrived after audio fail-open\n"));
runtime.on("diagnostic", (message) => process.stderr.write(message));
runtime.on("runtimeError", (error) => { consoleStatus.runtime = "error"; consoleStatus.last_error = error.message; process.stderr.write(`StackChan XiaoZhi runtime error: ${error.message}\n`); });
runtime.on("brokerExit", ({ code, signal }) => process.stderr.write(`StackChan WASAPI broker exited code=${code} signal=${signal}\n`));
transcriptSource.on("started", ({ databasePath }) => process.stderr.write(`StackChan Codex transcript source ${databasePath}\n`));
transcriptSource.on("sourceError", (error) => process.stderr.write(`StackChan Codex transcript source error: ${error.message}\n`));
transcriptSource.on("assistantResponseStarted", () => transcriptPresenter.beginAssistantResponse());
transcriptSource.on("assistantTextDelta", ({ text }) => transcriptPresenter.appendAssistantText(text));
transcriptSource.on("assistantTextDone", ({ text }) => transcriptPresenter.completeAssistantText(text));
transcriptSource.on("userSpeechStarted", () => transcriptPresenter.clear());
transcriptSource.on("sourceError", () => transcriptPresenter.clear());
let subtitleDiagnosticCount = 0;
let subtitleDiagnosticLastLog = 0;
transcriptPresenter.on("presented", ({ text }) => {
  subtitleDiagnosticCount += 1;
  const now = Date.now();
  if (now - subtitleDiagnosticLastLog < 1_000) return;
  process.stderr.write(`StackChan subtitle updates=${subtitleDiagnosticCount} latest_chars=${text.length}\n`);
  subtitleDiagnosticCount = 0;
  subtitleDiagnosticLastLog = now;
});
transcriptPresenter.on("presentationError", (error) => process.stderr.write(`StackChan transcript display error: ${error.message}\n`));

transcriptSource.start();
let address;
const localAdmin = new XiaozhiLocalAdmin({
  dock: runtime.dock,
  token,
  statusProvider: () => ({
    dock: { connected: runtime.dock.connected, device_id: runtime.dock.deviceId, session_id: runtime.dock.sessionId },
    voice: consoleStatus.voice,
    subtitle: consoleStatus.subtitle,
    runtime: consoleStatus.runtime,
    last_error: consoleStatus.last_error,
  }),
});
try {
  address = await runtime.start();
  await localAdmin.start();
  if (consoleStatus.runtime === "starting") consoleStatus.runtime = "waiting_for_robot";
} catch (error) {
  transcriptSource.stop();
  transcriptPresenter.dispose();
  await localAdmin.stop().catch(() => {});
  throw error;
}
let mcpServer = null;
if (!standalone) {
  mcpServer = createStackchanMcpServer(runtime.dock);
  await mcpServer.connect(new StdioServerTransport());
}
process.stderr.write(`StackChan bootstrap ${address.bootstrap.url}\n`);
process.stderr.write(`StackChan XiaoZhi websocket ${address.websocket.url}\n`);
process.stderr.write(`StackChan local volume admin ${localAdmin.pipePath}\n`);
if (standalone) process.stderr.write("StackChan XiaoZhi standalone diagnostics ready\n");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  transcriptSource.stop();
  transcriptPresenter.dispose();
  await localAdmin.stop();
  await mcpServer?.close();
  await runtime.stop();
}
process.once("SIGINT", () => stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => stop().finally(() => process.exit(0)));
