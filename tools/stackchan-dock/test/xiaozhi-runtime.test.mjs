import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";

import WebSocket from "ws";

import { XIAOZHI_UPLINK_AUDIO } from "../src/xiaozhi-websocket-server.mjs";
import { XiaozhiDockRuntime } from "../src/xiaozhi-runtime.mjs";

const token = "0123456789abcdef".repeat(4);
const deviceId = "aabbccddeeff";

class FakeBroker extends EventEmitter {
  running = false;
  microphone = [];
  start() { this.running = true; }
  async writeMicrophoneOpus(opus) { this.microphone.push(Buffer.from(opus)); }
  async stop() { this.running = false; }
}

test("unified runtime exposes authenticated bootstrap, XiaoZhi audio, and robot MCP on one session", async (t) => {
  const broker = new FakeBroker();
  const runtime = new XiaozhiDockRuntime({
    token,
    expectedDeviceId: deviceId,
    advertiseHost: "127.0.0.1",
    websocketHost: "127.0.0.1",
    websocketPort: 0,
    bootstrapHost: "127.0.0.1",
    bootstrapPort: 0,
    broker,
  });
  runtime.on("runtimeError", (error) => assert.fail(error));
  const address = await runtime.start();
  t.after(() => runtime.stop());
  assert.equal(broker.running, true);

  const bootstrap = await fetch(address.bootstrap.url, {
    headers: { Authorization: `Bearer ${token}`, "Device-Id": deviceId },
  });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).websocket.url, address.websocket.url);

  const socket = new WebSocket(address.websocket.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Protocol-Version": "1",
      "Device-Id": deviceId,
      "Client-Id": "runtime-test",
    },
  });
  await once(socket, "open");
  const authenticated = once(runtime, "authenticated");
  const helloReply = once(socket, "message");
  socket.send(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    audio_params: { ...XIAOZHI_UPLINK_AUDIO },
    features: { mcp: true },
  }));
  await authenticated;
  await helloReply;

  socket.send(Buffer.from([1, 2, 3]));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(broker.microphone, [Buffer.from([1, 2, 3])]);

  const head = runtime.dock.getHead();
  const [mcpWire] = await once(socket, "message");
  const request = JSON.parse(Buffer.from(mcpWire).toString("utf8"));
  assert.equal(request.type, "mcp");
  assert.equal(request.payload.params.name, "self.robot.get_head_angles");
  socket.send(JSON.stringify({
    session_id: runtime.server.sessionId,
    type: "mcp",
    payload: { jsonrpc: "2.0", id: request.payload.id, result: { yaw: 1, pitch: 2 } },
  }));
  assert.deepEqual(await head, { yaw: 1, pitch: 2 });
  socket.close();
});

test("runtime refuses ambiguous advertised addresses and can stop idempotently", async () => {
  assert.throws(() => new XiaozhiDockRuntime({ token, expectedDeviceId: deviceId, broker: new FakeBroker() }), /advertiseHost/);
  const runtime = new XiaozhiDockRuntime({
    token,
    expectedDeviceId: deviceId,
    advertiseHost: "127.0.0.1",
    websocketHost: "127.0.0.1",
    websocketPort: 0,
    bootstrapHost: "127.0.0.1",
    bootstrapPort: 0,
    broker: new FakeBroker(),
  });
  await runtime.start();
  await runtime.stop();
  await runtime.stop();
  assert.equal(runtime.started, false);
});
