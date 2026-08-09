#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStackchanMcpServer } from "../src/mcp.mjs";
import { XiaozhiDockRuntime } from "../src/xiaozhi-runtime.mjs";

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

const runtime = new XiaozhiDockRuntime({
  token,
  expectedDeviceId,
  advertiseHost,
  websocketPort,
  bootstrapPort,
  binaryPath,
  codexPid,
  renderDevice,
});
runtime.on("authenticated", ({ deviceId }) => process.stderr.write(`StackChan XiaoZhi authenticated device=${deviceId}\n`));
runtime.on("disconnected", ({ code, reason }) => process.stderr.write(`StackChan XiaoZhi disconnected code=${code} reason=${reason}\n`));
runtime.on("speaking", (speaking) => process.stderr.write(`StackChan half_duplex_speaking=${speaking}\n`));
runtime.on("diagnostic", (message) => process.stderr.write(message));
runtime.on("runtimeError", (error) => process.stderr.write(`StackChan XiaoZhi runtime error: ${error.message}\n`));
runtime.on("brokerExit", ({ code, signal }) => process.stderr.write(`StackChan WASAPI broker exited code=${code} signal=${signal}\n`));

const address = await runtime.start();
let mcpServer = null;
if (!standalone) {
  mcpServer = createStackchanMcpServer(runtime.dock);
  await mcpServer.connect(new StdioServerTransport());
}
process.stderr.write(`StackChan bootstrap ${address.bootstrap.url}\n`);
process.stderr.write(`StackChan XiaoZhi websocket ${address.websocket.url}\n`);
if (standalone) process.stderr.write("StackChan XiaoZhi standalone diagnostics ready\n");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await mcpServer?.close();
  await runtime.stop();
}
process.once("SIGINT", () => stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => stop().finally(() => process.exit(0)));
