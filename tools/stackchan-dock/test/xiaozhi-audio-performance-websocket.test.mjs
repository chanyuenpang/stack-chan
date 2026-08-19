import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import WebSocket from "ws";

import { AudioPerformanceSummaryWriter, readAudioPerformanceSummaries } from "../src/xiaozhi-audio-performance-summary.mjs";
import { XIAOZHI_UPLINK_AUDIO, XiaozhiWebSocketServer } from "../src/xiaozhi-websocket-server.mjs";

const token = "0123456789abcdef".repeat(4);
const deviceId = "44:1b:f6:e2:78:a8";

function summary(sessionId, overrides = {}) {
  const numbered = (names) => Object.fromEntries(names.map((name, index) => [name, index + 1]));
  return {
    type: "audio_perf_summary",
    version: 1,
    seq: 1,
    window_ms: 5_000,
    queues: { decode: 1, playback: 2, encode: 0, send: 0, decode_hwm: 3, playback_hwm: 4 },
    counts: {
      ingress_received: 80, ingress_accepted: 80, decode_queue_drops: 0, timestamp_missing: 0,
      decode_failures: 0, i2s_write_failures: 0, underrun_candidates: 0, display_lock_failures: 0,
    },
    timing_us: numbered([
      "ingress_queue_wait_avg", "ingress_queue_wait_max", "ingress_to_decode_avg", "ingress_to_decode_max",
      "decoder_lock_wait_avg", "decoder_lock_wait_max", "decode_avg", "decode_max", "resample_avg", "resample_max",
      "decode_to_output_avg", "decode_to_output_max", "ingress_to_output_avg", "ingress_to_output_max",
      "output_call_avg", "output_call_max", "i2s_write_avg", "i2s_write_max", "output_gap_avg", "output_gap_max",
    ]),
    contention_us: numbered([
      "display_wait_avg", "display_wait_max", "display_span_avg", "display_span_max", "lvgl_wait_avg", "lvgl_wait_max",
      "lvgl_span_avg", "lvgl_span_max", "led_set_i2c_avg", "led_set_i2c_max", "led_refresh_i2c_avg", "led_refresh_i2c_max",
    ]),
    histograms: {
      ingress_to_output: [1, 2, 3, 4, 5], output_gap: [0, 0, 1, 0, 0],
      display_wait: [1, 0, 0, 0, 0], display_span: [1, 0, 0, 0, 0],
      lvgl_wait: [1, 0, 0, 0, 0], lvgl_span: [1, 0, 0, 0, 0],
    },
    heap: { free_bytes: 200_000, minimum_free_bytes: 150_000 },
    ...overrides,
  };
}

function notification(sessionId, overrides = {}) {
  return {
    session_id: sessionId,
    type: "mcp",
    payload: {
      jsonrpc: "2.0",
      method: "notifications/audio_performance_summary",
      params: summary(undefined, overrides),
    },
  };
}

async function connectAndHello(server, address, authorization = `Bearer ${token}`) {
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}${address.path}`, {
    headers: { Authorization: authorization, "Protocol-Version": "1", "Device-Id": deviceId, "Client-Id": "test" },
  });
  await once(socket, "open");
  const authenticated = once(server, "authenticated");
  socket.send(JSON.stringify({
    type: "hello", version: 1, features: { mcp: true }, transport: "websocket",
    audio_params: { ...XIAOZHI_UPLINK_AUDIO },
  }));
  const [identity] = await authenticated;
  return { socket, identity };
}

test("authenticated diagnostic summary is sanitized and rate-limited without entering generic message routing", async (t) => {
  let now = 10_000;
  const server = new XiaozhiWebSocketServer({
    token, expectedDeviceId: deviceId, handshakeTimeoutMs: 1_000,
    audioPerformanceMinIntervalMs: 4_000, audioPerformanceNow: () => now,
  });
  const address = await server.listen({ host: "127.0.0.1" });
  t.after(() => server.close());
  const { socket, identity } = await connectAndHello(server, address);
  t.after(() => socket.close());

  let genericMessages = 0;
  let genericMcpMessages = 0;
  server.on("message", () => { genericMessages += 1; });
  server.on("mcp", () => { genericMcpMessages += 1; });
  const accepted = once(server, "audioPerformanceSummary");
  socket.send(JSON.stringify(notification(identity.sessionId)));
  const [value] = await accepted;
  assert.equal(value.seq, 1);
  assert.equal(Object.hasOwn(value, "session_id"), false);
  assert.equal(genericMessages, 0);
  assert.equal(genericMcpMessages, 0);

  const rateDropped = once(server, "audioPerformanceDropped");
  socket.send(JSON.stringify(notification(identity.sessionId, { seq: 2 })));
  assert.deepEqual((await rateDropped)[0], { reason: "rate_limit" });
  now += 4_000;
  const secondAccepted = once(server, "audioPerformanceSummary");
  socket.send(JSON.stringify(notification(identity.sessionId, { seq: 3 })));
  assert.equal((await secondAccepted)[0].seq, 3);
  assert.equal(server.stats.audioPerformanceAccepted, 2);
  assert.equal(server.stats.audioPerformanceRateDropped, 1);

  const rawRejected = once(server, "audioPerformanceRejected");
  socket.send(JSON.stringify({ ...summary(), session_id: identity.sessionId }));
  assert.match((await rawRejected)[0].reason, /requires the authenticated MCP notification envelope/);
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test("private text or audio-shaped fields are dropped without closing the authenticated audio session", async (t) => {
  const server = new XiaozhiWebSocketServer({ token, expectedDeviceId: deviceId, handshakeTimeoutMs: 1_000 });
  const address = await server.listen({ host: "127.0.0.1" });
  t.after(() => server.close());
  const { socket, identity } = await connectAndHello(server, address);
  t.after(() => socket.close());

  const rejected = once(server, "audioPerformanceRejected");
  socket.send(JSON.stringify(notification(identity.sessionId, { text: "must not cross the boundary", audio: [1, 2, 3] })));
  assert.match((await rejected)[0].reason, /unsupported field/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(socket.readyState, WebSocket.OPEN);
  assert.equal(server.connected, true);
  assert.equal(server.stats.audioPerformanceRejected, 1);
});

test("authenticated firmware envelope reaches the bounded NDJSON writer end to end", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stackchan-audio-perf-e2e-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "summary.ndjson");
  const writer = new AudioPerformanceSummaryWriter({ filePath, now: () => 1_786_530_000_000 });
  t.after(() => writer.close());

  const server = new XiaozhiWebSocketServer({ token, expectedDeviceId: deviceId, handshakeTimeoutMs: 1_000 });
  server.on("authenticated", () => writer.beginSession());
  server.on("disconnected", () => writer.endSession());
  server.on("audioPerformanceSummary", (value) => writer.offer(value));
  const address = await server.listen({ host: "127.0.0.1" });
  t.after(() => server.close());
  const { socket, identity } = await connectAndHello(server, address);
  t.after(() => socket.close());

  const written = once(writer, "written");
  socket.send(JSON.stringify(notification(identity.sessionId, { seq: 42 })));
  await written;
  const records = await readAudioPerformanceSummaries(filePath);
  assert.equal(records.length, 1);
  assert.equal(records[0].summary.seq, 42);
  assert.equal(server.stats.audioPerformanceAccepted, 1);
});
