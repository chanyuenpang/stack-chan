import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import WebSocket from "ws";

import {
  XIAOZHI_DOWNLINK_AUDIO,
  XIAOZHI_UPLINK_AUDIO,
  XiaozhiWebSocketServer,
  createXiaozhiServerHello,
  validateXiaozhiDeviceHello,
} from "../src/xiaozhi-websocket-server.mjs";

const token = "0123456789abcdef".repeat(4);
const deviceId = "aabbccddeeff";
const clientId = "test-client";

function deviceHello() {
  return {
    type: "hello",
    version: 1,
    features: { mcp: true },
    transport: "websocket",
    audio_params: { ...XIAOZHI_UPLINK_AUDIO },
  };
}

function connect(address, overrides = {}) {
  return new WebSocket(`ws://127.0.0.1:${address.port}${address.path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Protocol-Version": "1",
      "Device-Id": deviceId,
      "Client-Id": clientId,
      ...overrides,
    },
  });
}

async function openAndHello(server, address) {
  const socket = connect(address);
  await once(socket, "open");
  const authenticated = once(server, "authenticated");
  const helloReply = once(socket, "message");
  socket.send(JSON.stringify(deviceHello()));
  const [identity] = await authenticated;
  const [message, isBinary] = await helloReply;
  assert.equal(isBinary, false);
  const hello = JSON.parse(Buffer.from(message).toString("utf8"));
  assert.deepEqual(hello, createXiaozhiServerHello(identity.sessionId));
  return { socket, identity };
}

test("XiaoZhi v1 hello accepts only official 16 kHz mono 60 ms Opus", () => {
  assert.deepEqual(validateXiaozhiDeviceHello(deviceHello()), { supportsMcp: true, supportsServerAec: false });
  for (const audio_params of [
    { ...XIAOZHI_UPLINK_AUDIO, format: "pcm_s16le" },
    { ...XIAOZHI_UPLINK_AUDIO, sample_rate: 24_000 },
    { ...XIAOZHI_UPLINK_AUDIO, channels: 2 },
    { ...XIAOZHI_UPLINK_AUDIO, frame_duration: 20 },
  ]) {
    assert.throws(() => validateXiaozhiDeviceHello({ ...deviceHello(), audio_params }), /audio parameters/);
  }
  assert.equal(createXiaozhiServerHello("session").audio_params.sample_rate, XIAOZHI_DOWNLINK_AUDIO.sample_rate);
});

test("server authenticates headers, replaces old robots, and routes official v1 audio and JSON", async (t) => {
  const server = new XiaozhiWebSocketServer({ token, expectedDeviceId: deviceId, handshakeTimeoutMs: 1_000 });
  server.on("error", () => {});
  const address = await server.listen({ host: "127.0.0.1" });
  t.after(() => server.close());

  const first = await openAndHello(server, address);
  assert.equal(first.identity.deviceId, deviceId);
  assert.equal(first.identity.clientId, clientId);
  assert.equal(first.identity.capabilities.supportsMcp, true);

  const microphone = once(server, "microphoneOpus");
  first.socket.send(Buffer.from([1, 2, 3]));
  assert.deepEqual((await microphone)[0].opus, Buffer.from([1, 2, 3]));

  const listen = once(server, "listen");
  first.socket.send(JSON.stringify({ session_id: first.identity.sessionId, type: "listen", state: "start", mode: "auto" }));
  assert.equal((await listen)[0].state, "start");

  const downlinkMessages = [];
  first.socket.on("message", (message, isBinary) => downlinkMessages.push({ message: Buffer.from(message), isBinary }));
  server.sendTtsStart();
  server.sendTtsSentence("hello");
  server.sendDownlinkOpus(Buffer.from([9, 8, 7]));
  server.sendEmotion("happy", "😀");
  server.sendMcp({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} });
  server.sendTtsStop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(downlinkMessages.map(({ isBinary }) => isBinary), [false, false, true, false, false, false]);
  assert.deepEqual(downlinkMessages[2].message, Buffer.from([9, 8, 7]));

  const firstClosed = once(first.socket, "close");
  const second = await openAndHello(server, address);
  await firstClosed;
  assert.equal(server.deviceId, deviceId);
  assert.equal(server.stats.replacedConnections, 1);
  second.socket.close();
});

test("server rejects invalid authorization and pre-hello binary", async (t) => {
  const server = new XiaozhiWebSocketServer({ token, handshakeTimeoutMs: 1_000 });
  server.on("protocolError", () => {});
  const address = await server.listen({ host: "127.0.0.1" });
  t.after(() => server.close());

  const unauthorized = connect(address, { Authorization: "Bearer wrong" });
  await once(unauthorized, "open");
  const unauthorizedClose = once(unauthorized, "close");
  unauthorized.send(JSON.stringify(deviceHello()));
  assert.equal((await unauthorizedClose)[0], 1008);

  const binary = connect(address);
  await once(binary, "open");
  const binaryClose = once(binary, "close");
  binary.send(Buffer.from([1]));
  assert.equal((await binaryClose)[0], 1008);
});
