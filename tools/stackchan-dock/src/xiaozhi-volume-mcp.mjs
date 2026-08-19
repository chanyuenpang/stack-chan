import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { requestXiaozhiLocalAdmin } from "./xiaozhi-local-admin-client.mjs";

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

export async function getRobotSpeakerVolume({ token, request = requestXiaozhiLocalAdmin } = {}) {
  const result = await request({ token, operation: "get-speaker-volume" });
  if (!Number.isInteger(result?.volume) || result.volume < 0 || result.volume > 100) throw new Error("robot speaker volume was not reported");
  return { volume: result.volume };
}

export async function setRobotSpeakerVolume({ token, volume, request = requestXiaozhiLocalAdmin } = {}) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new TypeError("volume must be an integer from 0 to 100");
  const result = await request({ token, operation: "set-speaker-volume", volume });
  if (!Number.isInteger(result?.volume) || result.volume !== volume) throw new Error("robot speaker volume was not verified");
  return { requested_volume: volume, volume: result.volume, verified: true };
}

function assertLedColor(red, green, blue) {
  if (![red, green, blue].every((value) => Number.isInteger(value) && value >= 0 && value <= 168)) {
    throw new TypeError("LED channels must be integers from 0 to 168");
  }
}

export async function setRobotLedColor({ token, red, green, blue, request = requestXiaozhiLocalAdmin } = {}) {
  assertLedColor(red, green, blue);
  const result = await request({ token, operation: "set-robot-led-color", red, green, blue });
  if (!result?.accepted || result?.color?.red !== red || result?.color?.green !== green || result?.color?.blue !== blue) {
    throw new Error("robot LED color was not accepted by the authenticated Owner");
  }
  // Official MCP exposes a set call but no physical LED color read-back.
  return { requested_color: { red, green, blue }, accepted: true, device_readback: "unavailable" };
}

export async function clearRobotLedOverride({ token, request = requestXiaozhiLocalAdmin } = {}) {
  const result = await request({ token, operation: "clear-robot-led-override" });
  if (typeof result?.cleared !== "boolean") throw new Error("robot LED override clear was not acknowledged by the authenticated Owner");
  return { cleared: result.cleared, automatic_control: result.automatic_control === "enabled" };
}

export function createXiaozhiVolumeMcpServer({ token, request = requestXiaozhiLocalAdmin } = {}) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) throw new TypeError("local Dock token is invalid");
  if (typeof request !== "function") throw new TypeError("local admin request function is required");
  const server = new McpServer({ name: "stackchan-owner-volume", version: "0.1.0" });
  server.registerTool("stackchan_get_robot_speaker_volume", {
    description: "Read the current physical StackChan robot speaker volume through the authenticated Owner session.",
    inputSchema: z.strictObject({}), annotations: { readOnlyHint: true, idempotentHint: true },
  }, async () => toolResult(await getRobotSpeakerVolume({ token, request })));
  server.registerTool("stackchan_set_robot_speaker_volume", {
    description: "Set the physical StackChan robot speaker volume (integer 0..100). Success is returned only after the robot reports the requested value back.",
    inputSchema: z.strictObject({ volume: z.number().int().min(0).max(100) }), annotations: { idempotentHint: true },
  }, async ({ volume }) => toolResult(await setRobotSpeakerVolume({ token, volume, request })));
  server.registerTool("stackchan_set_robot_led_color", {
    description: "Set both StackChan robot LED banks to one RGB color through the authenticated Owner session. This creates a manual override; the physical LED driver has no color read-back.",
    inputSchema: z.strictObject({ red: z.number().int().min(0).max(168), green: z.number().int().min(0).max(168), blue: z.number().int().min(0).max(168) }),
    annotations: { idempotentHint: true },
  }, async ({ red, green, blue }) => toolResult(await setRobotLedColor({ token, red, green, blue, request })));
  server.registerTool("stackchan_clear_robot_led_override", {
    description: "Clear the manual StackChan robot LED color override so authenticated automatic status indication may resume.",
    inputSchema: z.strictObject({}), annotations: { idempotentHint: true },
  }, async () => toolResult(await clearRobotLedOverride({ token, request })));
  return server;
}
