import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { XiaozhiMcpError, XiaozhiStackchanDock } from "../src/xiaozhi-dock.mjs";

class FakeServer extends EventEmitter {
  connected = true;
  sessionId = "session-a";
  deviceId = "stackchan-a";
  sentMcp = [];
  sentEmotions = [];

  sendMcp(payload) { this.sentMcp.push(payload); }
  sendEmotion(emotion) { this.sentEmotions.push(emotion); }
}

test("official XiaoZhi Dock routes typed robot commands through JSON-RPC tools/call", async () => {
  const server = new FakeServer();
  const dock = new XiaozhiStackchanDock({ server }).attach();

  const pending = dock.setHead(12, 34, 180);
  assert.deepEqual(server.sentMcp[0], {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "self.robot.set_head_angles",
      arguments: { yaw: 12, pitch: 34, speed: 180 },
    },
  });
  server.emit("mcp", { jsonrpc: "2.0", id: 1, result: true });
  assert.equal(await pending, true);

  const head = dock.getHead();
  server.emit("mcp", { jsonrpc: "2.0", id: 2, result: { yaw: 12, pitch: 34 } });
  assert.deepEqual(await head, { yaw: 12, pitch: 34 });

  const led = dock.setLed(1, 2, 3);
  assert.equal(server.sentMcp[2].params.name, "self.robot.set_led_color");
  server.emit("mcp", { jsonrpc: "2.0", id: 3, result: true });
  assert.equal(await led, true);
  dock.detach();
});

test("status is bound to the active authenticated XiaoZhi session", async () => {
  const server = new FakeServer();
  const dock = new XiaozhiStackchanDock({ server }).attach();
  const status = dock.getStatus();
  server.emit("mcp", { jsonrpc: "2.0", id: 1, result: { audio_speaker: { volume: 70 } } });
  assert.deepEqual(await status, {
    transport: "xiaozhi-websocket-v1",
    connected: true,
    device_id: "stackchan-a",
    session_id: "session-a",
    device: { audio_speaker: { volume: 70 } },
  });
  dock.detach();
});

test("expression uses the official llm emotion message and audio control is not falsely acknowledged", async () => {
  const server = new FakeServer();
  const dock = new XiaozhiStackchanDock({ server }).attach();
  assert.deepEqual(await dock.setExpression("doubtful"), {
    ok: true,
    expression: "doubtful",
    delivery: "xiaozhi-websocket",
  });
  assert.deepEqual(server.sentEmotions, ["doubtful"]);
  assert.throws(() => dock.setAudioEndpoints({ microphone_enabled: false }), /official half-duplex session/);
  await assert.rejects(dock.setExpression("confused"), /unsupported/);
  dock.detach();
});

test("disconnect and replacement reject in-flight requests and late responses cannot satisfy newer calls", async () => {
  const server = new FakeServer();
  const dock = new XiaozhiStackchanDock({ server, requestTimeoutMs: 1_000 }).attach();

  const disconnected = dock.getHead();
  server.connected = false;
  server.sessionId = null;
  server.emit("disconnected", { code: 1006 });
  await assert.rejects(disconnected, /disconnected/);

  server.connected = true;
  server.sessionId = "session-b";
  server.emit("authenticated", { sessionId: "session-b" });
  const current = dock.getHead();
  server.emit("mcp", { jsonrpc: "2.0", id: 1, result: { yaw: 99, pitch: 99 } });
  server.emit("mcp", { jsonrpc: "2.0", id: 2, result: { yaw: 0, pitch: 0 } });
  assert.deepEqual(await current, { yaw: 0, pitch: 0 });
  dock.detach();
});

test("JSON-RPC errors and request timeouts are explicit", async () => {
  const server = new FakeServer();
  const dock = new XiaozhiStackchanDock({ server, requestTimeoutMs: 20 }).attach();

  const failed = dock.celebrate({ style: "cheer" });
  server.emit("mcp", { jsonrpc: "2.0", id: 1, error: { code: -32_001, message: "motion unavailable" } });
  await assert.rejects(failed, (error) => error instanceof XiaozhiMcpError && error.code === -32_001);
  await assert.rejects(dock.getHead(), /timed out/);
  dock.detach();
});
