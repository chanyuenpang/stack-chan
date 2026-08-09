import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import WebSocket from "ws";

import { XIAOZHI_UPLINK_AUDIO, XiaozhiWebSocketServer } from "../src/xiaozhi-websocket-server.mjs";
import {
  BrokerPacketParser,
  XiaozhiWasapiBridge,
  XiaozhiWasapiBroker,
  encodeBrokerPacket,
} from "../src/xiaozhi-wasapi-bridge.mjs";

const token = "0123456789abcdef".repeat(4);

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
  }

  kill() {
    this.exitCode = 0;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 0, null);
  }
}

function connect(address) {
  return new WebSocket(`ws://127.0.0.1:${address.port}${address.path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Protocol-Version": "1",
      "Device-Id": "aabbccddeeff",
      "Client-Id": "test-client",
    },
  });
}

async function authenticate(server, address) {
  const socket = connect(address);
  await once(socket, "open");
  const authenticated = once(server, "authenticated");
  const reply = once(socket, "message");
  socket.send(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    audio_params: { ...XIAOZHI_UPLINK_AUDIO },
  }));
  await authenticated;
  await reply;
  return socket;
}

test("broker framing survives fragmented and coalesced stream chunks", () => {
  const parser = new BrokerPacketParser();
  const wire = Buffer.concat([encodeBrokerPacket([1, 2, 3]), encodeBrokerPacket([]), encodeBrokerPacket([4])]);
  assert.deepEqual(parser.push(wire.subarray(0, 2)), []);
  assert.deepEqual(parser.push(wire.subarray(2, 9)).map(Buffer.from), [Buffer.from([1, 2, 3])]);
  assert.deepEqual(parser.push(wire.subarray(9)).map(Buffer.from), [Buffer.alloc(0), Buffer.from([4])]);
  parser.finish();
  assert.throws(() => encodeBrokerPacket(Buffer.alloc(1_501)), /exceeds/);
});

test("native broker wrapper frames microphone Opus and parses speaker activity", async () => {
  const child = new FakeChild();
  const broker = new XiaozhiWasapiBroker({
    binaryPath: "fake.exe",
    pid: 42,
    spawnImpl: () => child,
  });
  broker.on("error", () => {});
  broker.start();
  const written = once(child.stdin, "data");
  await broker.writeMicrophoneOpus(Buffer.from([7, 8, 9]));
  assert.deepEqual((await written)[0], encodeBrokerPacket([7, 8, 9]));

  const speaker = once(broker, "downlinkOpus");
  const stopped = once(broker, "activityStop");
  child.stdout.write(Buffer.concat([encodeBrokerPacket([4, 5]), encodeBrokerPacket([])]));
  assert.deepEqual((await speaker)[0], Buffer.from([4, 5]));
  await stopped;
  child.kill();
});

test("bridge maps official robot uplink and Codex downlink without PCM reinterpretation", async (t) => {
  const server = new XiaozhiWebSocketServer({ token });
  server.on("protocolError", () => {});
  const address = await server.listen({ host: "127.0.0.1" });
  const child = new FakeChild();
  const broker = new XiaozhiWasapiBroker({ binaryPath: "fake.exe", pid: 42, spawnImpl: () => child });
  broker.on("error", () => {});
  broker.start();
  const bridge = new XiaozhiWasapiBridge({ server, broker });
  bridge.on("error", (error) => assert.fail(error));
  bridge.attach();
  t.after(async () => {
    bridge.detach();
    child.kill();
    await server.close();
  });

  const socket = await authenticate(server, address);
  const microphoneWire = once(child.stdin, "data");
  socket.send(Buffer.from([1, 3, 5, 7]));
  assert.deepEqual((await microphoneWire)[0], encodeBrokerPacket([1, 3, 5, 7]));

  const messages = [];
  socket.on("message", (message, isBinary) => messages.push({ message: Buffer.from(message), isBinary }));
  child.stdout.write(Buffer.concat([encodeBrokerPacket([2, 4, 6]), encodeBrokerPacket([])]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(messages.map(({ isBinary }) => isBinary), [false, true, false]);
  assert.deepEqual(JSON.parse(messages[0].message).state, "start");
  assert.deepEqual(messages[1].message, Buffer.from([2, 4, 6]));
  assert.deepEqual(JSON.parse(messages[2].message).state, "stop");
  socket.close();
});
