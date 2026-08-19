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
  rootPid = 42;
  start() { this.running = true; }
  async writeMicrophoneOpus(opus) { this.microphone.push(Buffer.from(opus)); }
  async setCodexOutputRouted() {}
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

test("runtime forwards broker preflight and exit diagnostics without changing audio routing", async (t) => {
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
  const preflight = once(runtime, "brokerPreflight");
  const exit = once(runtime, "brokerExit");
  await runtime.start();
  t.after(() => runtime.stop());

  broker.emit("startupPreflight", { pid: 123, pidAlive: true, audioSession: "unobservable" });
  broker.emit("exit", { code: 1, signal: null, stderr: "AudioClient initialization failed" });

  assert.deepEqual((await preflight)[0], { pid: 123, pidAlive: true, audioSession: "unobservable" });
  assert.deepEqual((await exit)[0], { code: 1, signal: null, stderr: "AudioClient initialization failed" });
});

test("runtime forwards opt-in startup prebuffer telemetry without changing the default", async (t) => {
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
    startupPrebufferFrames: 2,
  });
  const address = await runtime.start();
  t.after(() => runtime.stop());
  const socket = new WebSocket(address.websocket.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Protocol-Version": "1",
      "Device-Id": deviceId,
      "Client-Id": "prebuffer-runtime-test",
    },
  });
  await once(socket, "open");
  const authenticated = once(runtime, "authenticated");
  const helloReply = once(socket, "message");
  socket.send(JSON.stringify({
    type: "hello", version: 1, transport: "websocket", audio_params: { ...XIAOZHI_UPLINK_AUDIO },
  }));
  await authenticated;
  await helloReply;
  const messages = [];
  socket.on("message", (message, isBinary) => messages.push({ message: Buffer.from(message), isBinary }));
  const started = once(runtime, "prebufferTiming");
  broker.emit("downlinkOpus", Buffer.from([1]));
  assert.equal((await started)[0].event_code, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(messages, []);
  const released = new Promise((resolve) => {
    const listener = (details) => {
      if (details.event_code !== 3) return;
      runtime.off("prebufferTiming", listener);
      resolve(details);
    };
    runtime.on("prebufferTiming", listener);
  });
  broker.emit("downlinkOpus", Buffer.from([2]));
  assert.equal((await released).target_frames, 2);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(messages.map(({ isBinary }) => isBinary), [false, true]);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.deepEqual(messages.map(({ isBinary }) => isBinary), [false, true, true]);
  socket.close();
});

test("mid-speech device close is observable once and later broker audio cannot revive that session", async (t) => {
  const broker = new FakeBroker();
  const runtime = new XiaozhiDockRuntime({
    token, expectedDeviceId: deviceId, advertiseHost: "127.0.0.1",
    websocketHost: "127.0.0.1", websocketPort: 0, bootstrapHost: "127.0.0.1", bootstrapPort: 0, broker,
  });
  const address = await runtime.start();
  t.after(() => runtime.stop());
  const socket = new WebSocket(address.websocket.url, { headers: {
    Authorization: `Bearer ${token}`, "Protocol-Version": "1", "Device-Id": deviceId, "Client-Id": "mid-speech-close-test",
  } });
  await once(socket, "open");
  const authenticated = once(runtime, "authenticated");
  socket.send(JSON.stringify({ type: "hello", version: 1, transport: "websocket", audio_params: { ...XIAOZHI_UPLINK_AUDIO } }));
  await authenticated;
  const speaking = once(runtime, "speaking");
  broker.emit("downlinkOpus", Buffer.from([1]));
  assert.equal((await speaking)[0], true);
  const disconnected = once(runtime, "disconnected");
  socket.close(1000, "user cancel");
  const [details] = await disconnected;
  assert.deepEqual(details, { deviceId, code: 1000, reason: "user cancel" });
  assert.equal(runtime.server.connected, false);
  const dropped = once(runtime, "downlinkDropped");
  broker.emit("downlinkOpus", Buffer.from([2]));
  assert.deepEqual((await dropped)[0], { reason: "robot_not_authenticated", bytes: 1 });
});
