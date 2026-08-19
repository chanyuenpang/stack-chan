import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AudioPerformanceSummaryWriter,
  extractAudioPerformanceSummaryNotification,
  isLocalAbsoluteFilePath,
  resolveLocalAbsoluteFilePath,
  readAudioPerformanceSummaries,
  validateAudioPerformanceSummary,
} from "../src/xiaozhi-audio-performance-summary.mjs";

function timing(names) {
  return Object.fromEntries(names.map((name, index) => [name, index + 1]));
}

function summary(overrides = {}) {
  return {
    type: "audio_perf_summary",
    version: 2,
    seq: 7,
    window_ms: 5_000,
    queues: { decode: 1, playback: 2, encode: 0, send: 0, decode_hwm: 3, playback_hwm: 4 },
    counts: {
      ingress_received: 80, ingress_accepted: 80, decode_queue_drops: 0, timestamp_missing: 0,
      decode_failures: 0, i2s_write_failures: 0, underrun_candidates: 0, display_lock_failures: 0,
      underrun_decomposition_missing: 0,
    },
    timing_us: timing([
      "ingress_queue_wait_avg", "ingress_queue_wait_max", "ingress_to_decode_avg", "ingress_to_decode_max",
      "decoder_lock_wait_avg", "decoder_lock_wait_max", "decode_avg", "decode_max", "resample_avg", "resample_max",
      "decode_to_output_avg", "decode_to_output_max", "ingress_to_output_avg", "ingress_to_output_max",
      "output_call_avg", "output_call_max", "i2s_write_avg", "i2s_write_max", "output_gap_avg", "output_gap_max",
      "underrun_previous_output_avg", "underrun_previous_output_max",
      "underrun_ready_late_avg", "underrun_ready_late_max",
      "underrun_ready_wait_avg", "underrun_ready_wait_max",
    ]),
    contention_us: timing([
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

function legacySummary() {
  const value = summary({ version: 1 });
  delete value.counts.underrun_decomposition_missing;
  for (const field of [
    "underrun_previous_output_avg", "underrun_previous_output_max",
    "underrun_ready_late_avg", "underrun_ready_late_max",
    "underrun_ready_wait_avg", "underrun_ready_wait_max",
  ]) delete value.timing_us[field];
  return value;
}

test("audio performance summary accepts only the fixed numeric schema", () => {
  assert.deepEqual(validateAudioPerformanceSummary({ ...summary(), session_id: "session" }), summary());
  assert.deepEqual(validateAudioPerformanceSummary(legacySummary()), legacySummary());
  for (const invalid of [
    { ...summary(), text: "private transcript" },
    { ...summary(), audio: [1, 2, 3] },
    { ...summary(), seq: -1 },
    { ...summary(), window_ms: "5000" },
    { ...summary(), queues: { ...summary().queues, decode: 1.5 } },
    { ...summary(), histograms: { ...summary().histograms, output_gap: [1, 2] } },
    { ...summary(), heap: { ...summary().heap, note: "secret" } },
  ]) assert.throws(() => validateAudioPerformanceSummary(invalid), TypeError);
});

test("audio performance notification is a fixed JSON-RPC notification with no request id", () => {
  const value = summary();
  assert.deepEqual(extractAudioPerformanceSummaryNotification({
    jsonrpc: "2.0",
    method: "notifications/audio_performance_summary",
    params: value,
  }), value);
  assert.throws(() => extractAudioPerformanceSummaryNotification({
    jsonrpc: "2.0", id: 1, method: "notifications/audio_performance_summary", params: value,
  }), /unsupported field id/);
  assert.throws(() => extractAudioPerformanceSummaryNotification({
    jsonrpc: "2.0", method: "tools\/call", params: value,
  }), /unsupported audio performance notification method/);
});

test("persistence accepts local absolute files and rejects UNC, device, relative, and root paths", () => {
  assert.equal(isLocalAbsoluteFilePath("D:\\StackChan\\audio-perf.ndjson", "win32"), true);
  assert.equal(isLocalAbsoluteFilePath("D:/StackChan/audio-perf.ndjson", "win32"), true);
  assert.equal(isLocalAbsoluteFilePath("\\\\server\\share\\audio-perf.ndjson", "win32"), false);
  assert.equal(isLocalAbsoluteFilePath("\\\\?\\D:\\audio-perf.ndjson", "win32"), false);
  assert.equal(isLocalAbsoluteFilePath("D:audio-perf.ndjson", "win32"), false);
  assert.equal(isLocalAbsoluteFilePath("D:\\", "win32"), false);
  assert.equal(isLocalAbsoluteFilePath("/var/tmp/audio-perf.ndjson", "linux"), true);
  assert.equal(isLocalAbsoluteFilePath("audio-perf.ndjson", "linux"), false);
  assert.equal(resolveLocalAbsoluteFilePath("D:\\sample\\audio-perf.ndjson", {
    platform: "win32",
    realpathParent: () => "D:\\sample",
    lstatFile: () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
  }), "D:\\sample\\audio-perf.ndjson");
  assert.throws(() => resolveLocalAbsoluteFilePath("D:\\sample\\audio-perf.ndjson", {
    platform: "win32", realpathParent: () => "\\\\server\\share", lstatFile: () => assert.fail(),
  }), /resolves outside/);
  assert.throws(() => resolveLocalAbsoluteFilePath("D:\\sample\\audio-perf.ndjson", {
    platform: "win32", realpathParent: () => "D:\\sample", lstatFile: () => ({ isSymbolicLink: () => true }),
  }), /must not be a symbolic link/);
});

test("writer is opt-in, bounded, has no backlog, and drops disconnected samples", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stackchan-audio-perf-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "summary.ndjson");
  let releaseStat;
  const statBarrier = new Promise((resolve) => { releaseStat = resolve; });
  let firstStat = true;
  const writer = new AudioPerformanceSummaryWriter({
    filePath,
    now: () => 1_786_530_000_000,
    statFile: async () => {
      if (firstStat) { firstStat = false; await statBarrier; }
      const error = new Error("missing"); error.code = "ENOENT"; throw error;
    },
  });
  const dropped = [];
  writer.on("dropped", (details) => dropped.push(details.reason));
  writer.on("error", (error) => assert.fail(error));

  assert.equal(writer.offer(summary()), false);
  writer.beginSession();
  assert.equal(writer.offer(summary()), true);
  assert.equal(writer.offer(summary({ seq: 8 })), false);
  writer.endSession();
  releaseStat();
  await writer.flush();
  assert.deepEqual(dropped, ["disconnected", "writer_busy", "disconnected"]);

  writer.beginSession();
  assert.equal(writer.offer(summary({ seq: 9 })), true);
  await writer.flush();
  const records = await readAudioPerformanceSummaries(filePath);
  assert.equal(records.length, 1);
  assert.equal(records[0].received_at_ms, 1_786_530_000_000);
  assert.equal(records[0].summary.seq, 9);
  await writer.close();
});

test("writer drops a record instead of exceeding its fixed file cap", async () => {
  const dropped = [];
  let appendCalled = false;
  const writer = new AudioPerformanceSummaryWriter({
    filePath: path.resolve("bounded-audio-performance.ndjson"),
    maximumBytes: 4_096,
    statFile: async () => ({ size: 4_000 }),
    append: async () => { appendCalled = true; },
  });
  writer.on("dropped", (details) => dropped.push(details.reason));
  writer.beginSession();
  assert.equal(writer.offer(summary()), true);
  await writer.flush();
  assert.equal(appendCalled, false);
  assert.deepEqual(dropped, ["file_limit"]);
});
