import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export const MCP_TOOL = Object.freeze({
  GET_STATUS: "stackchan_get_status",
  SET_AUDIO: "stackchan_set_audio",
  SET_EXPRESSION: "stackchan_set_expression",
  SET_LED: "stackchan_set_led",
  GET_HEAD: "stackchan_get_head",
  SET_HEAD: "stackchan_set_head",
});

const noArguments = z.strictObject({});
const audioArguments = z.strictObject({
  microphone_enabled: z.boolean().optional(),
  speaker_enabled: z.boolean().optional(),
}).refine(
  ({ microphone_enabled, speaker_enabled }) =>
    microphone_enabled !== undefined || speaker_enabled !== undefined,
  { message: "at least one audio endpoint must be provided" },
);
const expressionArguments = z.strictObject({
  expression: z.enum(["neutral", "happy", "angry", "sad", "doubtful"]),
});
const ledArguments = z.strictObject({
  red: z.number().int().min(0).max(168),
  green: z.number().int().min(0).max(168),
  blue: z.number().int().min(0).max(168),
});
const headArguments = z.strictObject({
  yaw: z.number().int().min(-128).max(128),
  pitch: z.number().int().min(0).max(90),
  speed: z.number().int().min(100).max(300),
});

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function register(server, name, description, inputSchema, annotations, handler) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) =>
    toolResult(await handler(args)));
}

export function createStackchanMcpServer(dock) {
  if (!dock || typeof dock !== "object") throw new TypeError("dock is required");
  const server = new McpServer({
    name: "stackchan-codex-companion",
    version: "0.1.0",
  });

  register(server, MCP_TOOL.GET_STATUS,
    "Read the live Stack-chan device and audio endpoint state.",
    noArguments, { readOnlyHint: true, idempotentHint: true },
    () => dock.getStatus());
  if (dock.capabilities?.audioControl !== false) {
    register(server, MCP_TOOL.SET_AUDIO,
      "Enable or disable Stack-chan's own microphone and speaker data paths; this does not control a Codex Voice session.",
      audioArguments, { idempotentHint: true },
      (args) => dock.setAudioEndpoints(args));
  }
  register(server, MCP_TOOL.SET_EXPRESSION,
    "Set Stack-chan's screen expression to an allowlisted value.",
    expressionArguments, { idempotentHint: true },
    ({ expression }) => dock.setExpression(expression));
  register(server, MCP_TOOL.SET_LED,
    "Set Stack-chan's LED channels within the firmware-safe 0..168 range.",
    ledArguments, { idempotentHint: true },
    ({ red, green, blue }) => dock.setLed(red, green, blue));
  register(server, MCP_TOOL.GET_HEAD,
    "Read Stack-chan's current head pose.",
    noArguments, { readOnlyHint: true, idempotentHint: true },
    () => dock.getHead());
  register(server, MCP_TOOL.SET_HEAD,
    "Move Stack-chan's head within the firmware-safe yaw, pitch, and speed ranges.",
    headArguments, { idempotentHint: true },
    ({ yaw, pitch, speed }) => dock.setHead(yaw, pitch, speed));

  return server;
}
