import { EventEmitter } from "node:events";
import { lstatSync, realpathSync } from "node:fs";
import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const AUDIO_PERFORMANCE_SUMMARY_TYPE = "audio_perf_summary";
export const AUDIO_PERFORMANCE_SUMMARY_VERSION = 2;
export const AUDIO_PERFORMANCE_SUMMARY_METHOD = "notifications/audio_performance_summary";
export const DEFAULT_AUDIO_PERFORMANCE_MIN_INTERVAL_MS = 4_000;
export const DEFAULT_AUDIO_PERFORMANCE_FILE_LIMIT_BYTES = 8 * 1024 * 1024;

const UINT32_MAX = 0xffff_ffff;
const MAX_RECORD_BYTES = 4_096;

const QUEUE_FIELDS = ["decode", "playback", "encode", "send", "decode_hwm", "playback_hwm"];
const COUNT_FIELDS_V1 = [
  "ingress_received", "ingress_accepted", "decode_queue_drops", "timestamp_missing",
  "decode_failures", "i2s_write_failures", "underrun_candidates", "display_lock_failures",
];
const COUNT_FIELDS = [...COUNT_FIELDS_V1, "underrun_decomposition_missing"];
const TIMING_FIELDS_V1 = [
  "ingress_queue_wait_avg", "ingress_queue_wait_max", "ingress_to_decode_avg", "ingress_to_decode_max",
  "decoder_lock_wait_avg", "decoder_lock_wait_max", "decode_avg", "decode_max", "resample_avg",
  "resample_max", "decode_to_output_avg", "decode_to_output_max", "ingress_to_output_avg",
  "ingress_to_output_max", "output_call_avg", "output_call_max", "i2s_write_avg", "i2s_write_max",
  "output_gap_avg", "output_gap_max",
];
const TIMING_FIELDS = [
  ...TIMING_FIELDS_V1,
  "underrun_previous_output_avg", "underrun_previous_output_max",
  "underrun_ready_late_avg", "underrun_ready_late_max",
  "underrun_ready_wait_avg", "underrun_ready_wait_max",
];
const CONTENTION_FIELDS = [
  "display_wait_avg", "display_wait_max", "display_span_avg", "display_span_max",
  "lvgl_wait_avg", "lvgl_wait_max", "lvgl_span_avg", "lvgl_span_max",
  "led_set_i2c_avg", "led_set_i2c_max", "led_refresh_i2c_avg", "led_refresh_i2c_max",
];
const HISTOGRAM_FIELDS = [
  "ingress_to_output", "output_gap", "display_wait", "display_span", "lvgl_wait", "lvgl_span",
];
const HEAP_FIELDS = ["free_bytes", "minimum_free_bytes"];
const SUMMARY_FIELDS = [
  "type", "version", "seq", "window_ms", "queues", "counts", "timing_us",
  "contention_us", "histograms", "heap",
];

function reject(message) {
  throw new TypeError(message);
}

export function isLocalAbsoluteFilePath(filePath, platform = process.platform) {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 1_024 || filePath.includes("\0")) return false;
  if (platform === "win32") {
    // Reject UNC, device, and drive-relative paths. The Owner may write only to
    // an explicitly selected file on a local drive.
    if (!/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("\\\\?\\")) return false;
    return path.win32.parse(filePath).root.toLowerCase() !== filePath.toLowerCase();
  }
  return path.posix.isAbsolute(filePath) && path.posix.parse(filePath).root !== filePath;
}

export function resolveLocalAbsoluteFilePath(filePath, {
  platform = process.platform,
  realpathParent = realpathSync.native,
  lstatFile = lstatSync,
} = {}) {
  if (!isLocalAbsoluteFilePath(filePath, platform)) reject("audio performance file path must be an absolute local file path");
  const implementation = platform === "win32" ? path.win32 : path.posix;
  const parent = realpathParent(implementation.dirname(filePath));
  const resolved = implementation.join(parent, implementation.basename(filePath));
  if (!isLocalAbsoluteFilePath(resolved, platform)) reject("audio performance parent resolves outside a local absolute path");
  try {
    if (lstatFile(resolved).isSymbolicLink()) reject("audio performance file must not be a symbolic link");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, fields, name, optional = []) {
  if (!isPlainObject(value)) reject(`${name} must be an object`);
  const allowed = new Set([...fields, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reject(`${name} contains unsupported field ${key}`);
  }
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) reject(`${name} is missing field ${key}`);
  }
}

function uint32(value, name, { minimum = 0, maximum = UINT32_MAX } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    reject(`${name} must be an unsigned 32-bit integer in range ${minimum}..${maximum}`);
  }
  return value;
}

function numericObject(value, fields, name) {
  assertExactKeys(value, fields, name);
  return Object.fromEntries(fields.map((field) => [field, uint32(value[field], `${name}.${field}`)]));
}

function histograms(value) {
  assertExactKeys(value, HISTOGRAM_FIELDS, "audio performance histograms");
  return Object.fromEntries(HISTOGRAM_FIELDS.map((field) => {
    const buckets = value[field];
    if (!Array.isArray(buckets) || buckets.length !== 5) {
      reject(`audio performance histograms.${field} must contain exactly five buckets`);
    }
    return [field, buckets.map((bucket, index) => uint32(bucket, `audio performance histograms.${field}[${index}]`))];
  }));
}

export function validateAudioPerformanceSummary(value) {
  assertExactKeys(value, SUMMARY_FIELDS, "audio performance summary", ["session_id"]);
  if (value.type !== AUDIO_PERFORMANCE_SUMMARY_TYPE) reject("unsupported audio performance summary type");
  if (value.version !== 1 && value.version !== AUDIO_PERFORMANCE_SUMMARY_VERSION) {
    reject("unsupported audio performance summary version");
  }
  if (Object.hasOwn(value, "session_id") && (typeof value.session_id !== "string" || value.session_id.length === 0)) {
    reject("audio performance session id must be a non-empty string");
  }
  const summary = {
    type: AUDIO_PERFORMANCE_SUMMARY_TYPE,
    version: value.version,
    seq: uint32(value.seq, "audio performance summary.seq"),
    window_ms: uint32(value.window_ms, "audio performance summary.window_ms", { minimum: 1_000, maximum: 60_000 }),
    queues: numericObject(value.queues, QUEUE_FIELDS, "audio performance queues"),
    counts: numericObject(
      value.counts,
      value.version === 1 ? COUNT_FIELDS_V1 : COUNT_FIELDS,
      "audio performance counts",
    ),
    timing_us: numericObject(
      value.timing_us,
      value.version === 1 ? TIMING_FIELDS_V1 : TIMING_FIELDS,
      "audio performance timing_us",
    ),
    contention_us: numericObject(value.contention_us, CONTENTION_FIELDS, "audio performance contention_us"),
    histograms: histograms(value.histograms),
    heap: numericObject(value.heap, HEAP_FIELDS, "audio performance heap"),
  };
  if (Buffer.byteLength(JSON.stringify(summary), "utf8") > MAX_RECORD_BYTES) {
    reject("audio performance summary exceeds the fixed record limit");
  }
  return summary;
}

export function extractAudioPerformanceSummaryNotification(payload) {
  assertExactKeys(payload, ["jsonrpc", "method", "params"], "audio performance notification");
  if (payload.jsonrpc !== "2.0") reject("audio performance notification jsonrpc must be 2.0");
  if (payload.method !== AUDIO_PERFORMANCE_SUMMARY_METHOD) reject("unsupported audio performance notification method");
  return validateAudioPerformanceSummary(payload.params);
}

export class AudioPerformanceSummaryWriter extends EventEmitter {
  #filePath;
  #maximumBytes;
  #append;
  #stat;
  #now;
  #generation = 0;
  #sessionActive = false;
  #inFlight = null;
  #closed = false;

  constructor({
    filePath,
    maximumBytes = DEFAULT_AUDIO_PERFORMANCE_FILE_LIMIT_BYTES,
    append = appendFile,
    statFile = stat,
    now = Date.now,
  } = {}) {
    super();
    filePath = resolveLocalAbsoluteFilePath(filePath);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < MAX_RECORD_BYTES) reject("audio performance file limit is invalid");
    if (typeof append !== "function" || typeof statFile !== "function" || typeof now !== "function") reject("audio performance writer dependencies are invalid");
    this.#filePath = filePath;
    this.#maximumBytes = maximumBytes;
    this.#append = append;
    this.#stat = statFile;
    this.#now = now;
  }

  beginSession() {
    if (this.#closed) reject("audio performance writer is closed");
    this.#generation += 1;
    this.#sessionActive = true;
  }

  endSession() {
    this.#generation += 1;
    this.#sessionActive = false;
  }

  offer(value) {
    const summary = validateAudioPerformanceSummary(value);
    if (this.#closed || !this.#sessionActive) {
      this.emit("dropped", { reason: "disconnected" });
      return false;
    }
    if (this.#inFlight !== null) {
      this.emit("dropped", { reason: "writer_busy" });
      return false;
    }
    const generation = this.#generation;
    const line = `${JSON.stringify({ received_at_ms: uint32(this.#now(), "received_at_ms", { maximum: Number.MAX_SAFE_INTEGER }), summary })}\n`;
    this.#inFlight = this.#persist(line, generation).finally(() => { this.#inFlight = null; });
    return true;
  }

  async flush() {
    await this.#inFlight;
  }

  async close() {
    this.#closed = true;
    this.endSession();
    await this.flush();
  }

  async #persist(line, generation) {
    let size = 0;
    try {
      size = (await this.#stat(this.#filePath)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.emit("error", error);
        return;
      }
    }
    if (!this.#sessionActive || generation !== this.#generation) {
      this.emit("dropped", { reason: "disconnected" });
      return;
    }
    if (size + Buffer.byteLength(line, "utf8") > this.#maximumBytes) {
      this.emit("dropped", { reason: "file_limit" });
      return;
    }
    try {
      await this.#append(this.#filePath, line, { encoding: "utf8", flag: "a" });
      this.emit("written");
    } catch (error) {
      this.emit("error", error);
    }
  }
}

export async function readAudioPerformanceSummaries(filePath, { limit = 100 } = {}) {
  filePath = resolveLocalAbsoluteFilePath(filePath);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) reject("audio performance read limit is invalid");
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean).slice(-limit);
  return lines.map((line) => {
    const record = JSON.parse(line);
    assertExactKeys(record, ["received_at_ms", "summary"], "stored audio performance record");
    return {
      received_at_ms: uint32(record.received_at_ms, "stored audio performance received_at_ms", { maximum: Number.MAX_SAFE_INTEGER }),
      summary: validateAudioPerformanceSummary(record.summary),
    };
  });
}
