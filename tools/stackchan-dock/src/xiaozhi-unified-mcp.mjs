import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { requestXiaozhiLocalAdmin } from "./xiaozhi-local-admin-client.mjs";

export const STACKCHAN_UNIFIED_MCP_VERSION = "1.0.0";
export const STACKCHAN_UNIFIED_MCP_TOOLS = Object.freeze({
  GET_HEALTH: "stackchan_system_get_health",
  GET_CAPABILITIES: "stackchan_system_get_capabilities",
  GET_STATUS: "stackchan_get_status",
  GET_HEAD: "stackchan_get_head",
  SET_HEAD: "stackchan_set_head",
  SET_LED: "stackchan_set_led",
  CLEAR_LED: "stackchan_clear_led_override",
  GET_SPEAKER_VOLUME: "stackchan_get_robot_speaker_volume",
  SET_SPEAKER_VOLUME: "stackchan_set_robot_speaker_volume",
});

const noArguments = z.strictObject({});
const rgbArguments = z.strictObject({ red: z.number().int().min(0).max(168), green: z.number().int().min(0).max(168), blue: z.number().int().min(0).max(168) });
const headArguments = z.strictObject({ yaw: z.number().int().min(-45).max(45), pitch: z.number().int().min(0).max(45), speed: z.number().int().min(100).max(300) });
const volumeArguments = z.strictObject({ volume: z.number().int().min(0).max(100) });

function toolResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }; }

function requireToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) throw new TypeError("local Dock token is invalid");
}

async function ownerRequest({ token, operation, request = requestXiaozhiLocalAdmin, ...arguments_ }) {
  try { return await request({ token, operation, ...arguments_ }); }
  catch (error) {
    const message = String(error?.message ?? error);
    if (/ENOENT|ECONNREFUSED|pipe/i.test(message)) throw new Error(`OWNER_UNAVAILABLE: ${message}`);
    if (/not authenticated|device is not connected/i.test(message)) throw new Error(`DEVICE_OFFLINE: ${message}`);
    throw error;
  }
}

export async function getStackchanHealth({ token, request } = {}) {
  requireToken(token);
  const status = await ownerRequest({ token, operation: "get-console-status", request });
  return {
    contract_version: status.contract_version ?? 1,
    mcp_version: STACKCHAN_UNIFIED_MCP_VERSION,
    owner: status.owner ?? { state: "ready" },
    dock: status.dock ?? { connected: false, device_id: null, session_id: null },
    capabilities: capabilities(status),
  };
}

function capabilities(status = {}) {
  const connected = status?.dock?.connected === true;
  return {
    status: { state: "available" },
    head: { state: connected ? "available" : "offline" },
    lighting: { state: connected ? "available" : "offline" },
    speaker_volume: { state: connected ? "available" : "offline" },
    camera: { state: "deferred", reason: "not part of the unified MCP v1 rollout" },
  };
}

export async function getStackchanStatus({ token, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "get-console-status", request });
}

export async function getStackchanHead({ token, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "get-robot-head", request });
}

export async function setStackchanHead({ token, yaw, pitch, speed, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "set-robot-head", yaw, pitch, speed, request });
}

export async function setStackchanLed({ token, red, green, blue, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "set-robot-led-color", red, green, blue, request });
}

export async function clearStackchanLed({ token, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "clear-robot-led-override", request });
}

export async function getStackchanSpeakerVolume({ token, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "get-speaker-volume", request });
}

export async function setStackchanSpeakerVolume({ token, volume, request } = {}) {
  requireToken(token);
  return ownerRequest({ token, operation: "set-speaker-volume", volume, request });
}

function register(server, name, description, inputSchema, annotations, handler) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) => toolResult(await handler(args)));
}

// This is deliberately only an MCP transport facade. Every device call goes
// through the authenticated local admin endpoint hosted by the Electron Owner;
// it never creates a Dock runtime, audio broker, or listener on 8765/8766.
export function createStackchanUnifiedMcpServer({ token, request = requestXiaozhiLocalAdmin } = {}) {
  requireToken(token);
  if (typeof request !== "function") throw new TypeError("local Owner request function is required");
  const server = new McpServer({ name: "stackchan", version: STACKCHAN_UNIFIED_MCP_VERSION });
  const context = { token, request };
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.GET_HEALTH, "Read the unique Electron Dock Owner health and capability availability.", noArguments, { readOnlyHint: true, idempotentHint: true }, () => getStackchanHealth(context));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.GET_CAPABILITIES, "Read the versioned StackChan MCP capability registry.", noArguments, { readOnlyHint: true, idempotentHint: true }, async () => (await getStackchanHealth(context)).capabilities);
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.GET_STATUS, "Read live StackChan Dock and robot session status from the authenticated Owner.", noArguments, { readOnlyHint: true, idempotentHint: true }, () => getStackchanStatus(context));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.GET_HEAD, "Read the current robot head pose through the authenticated Dock Owner.", noArguments, { readOnlyHint: true, idempotentHint: true }, () => getStackchanHead(context));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.SET_HEAD, "Move the robot head within the Owner-enforced safe yaw, pitch, and speed envelope.", headArguments, { idempotentHint: true }, (args) => setStackchanHead({ ...context, ...args }));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.SET_LED, "Set a manual RGB LED override through the Owner LED arbiter.", rgbArguments, { idempotentHint: true }, (args) => setStackchanLed({ ...context, ...args }));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.CLEAR_LED, "Clear manual LED override and restore automatic Owner status indication.", noArguments, { idempotentHint: true }, () => clearStackchanLed(context));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.GET_SPEAKER_VOLUME, "Read the physical robot speaker codec volume through the authenticated Owner.", noArguments, { readOnlyHint: true, idempotentHint: true }, () => getStackchanSpeakerVolume(context));
  register(server, STACKCHAN_UNIFIED_MCP_TOOLS.SET_SPEAKER_VOLUME, "Set robot speaker codec volume 0..100 and return only after Owner verification.", volumeArguments, { idempotentHint: true }, (args) => setStackchanSpeakerVolume({ ...context, ...args }));
  return server;
}
