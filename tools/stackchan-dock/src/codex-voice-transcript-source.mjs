import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REALTIME_TARGET = "codex_core::realtime_conversation";
const DEFAULT_POLL_INTERVAL_MS = 75;
const DEFAULT_BATCH_SIZE = 512;

function decodeRustDebugString(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`invalid Codex transcript string: ${error.message}`);
  }
}

export function parseCodexVoiceTranscriptEvent(body) {
  if (typeof body !== "string") return null;
  const delta = body.match(/OutputTranscriptDelta\(RealtimeTranscriptDelta \{ delta: ("(?:\\.|[^"\\])*") \}\)/);
  if (delta) return { type: "delta", text: decodeRustDebugString(delta[1]) };
  const done = body.match(/OutputTranscriptDone\(RealtimeTranscriptDone \{ text: ("(?:\\.|[^"\\])*") \}\)/);
  if (done) return { type: "done", text: decodeRustDebugString(done[1]) };
  const inputDelta = body.match(/InputTranscriptDelta\(RealtimeTranscriptDelta \{ delta: ("(?:\\.|[^"\\])*") \}\)/);
  if (inputDelta) return { type: "user_delta", text: decodeRustDebugString(inputDelta[1]) };
  return null;
}

export class CodexVoiceTranscriptSource extends EventEmitter {
  #databasePath;
  #pollIntervalMs;
  #batchSize;
  #database = null;
  #cursor = 0;
  #timer = null;
  #running = false;
  #activeProcessUuid = null;
  #assistantInterrupted = false;
  #userSpeechActive = false;

  constructor({
    databasePath = join(homedir(), ".codex", "logs_2.sqlite"),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
  } = {}) {
    super();
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
      throw new RangeError("pollIntervalMs must be a positive number");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError("batchSize must be a positive integer");
    }
    this.#databasePath = databasePath;
    this.#pollIntervalMs = pollIntervalMs;
    this.#batchSize = batchSize;
  }

  get running() { return this.#running; }
  get databasePath() { return this.#databasePath; }

  start() {
    if (this.#running) return;
    this.#database = new DatabaseSync(this.#databasePath, { readOnly: true });
    this.#validateSchema();
    this.#cursor = Number(this.#database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM logs").get().id);
    this.#running = true;
    this.emit("started", { databasePath: this.#databasePath, cursor: this.#cursor });
    this.#schedule();
  }

  stop() {
    if (!this.#running && !this.#database) return;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#database?.close();
    this.#database = null;
    this.#activeProcessUuid = null;
    this.#assistantInterrupted = false;
    this.#userSpeechActive = false;
    this.emit("stopped");
  }

  #validateSchema() {
    const columns = new Set(this.#database.prepare("PRAGMA table_info(logs)").all().map((row) => row.name));
    for (const required of ["id", "target", "feedback_log_body", "process_uuid"]) {
      if (!columns.has(required)) throw new Error(`unsupported Codex logs schema: missing logs.${required}`);
    }
  }

  #schedule() {
    if (!this.#running || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      try {
        this.#poll();
      } catch (error) {
        this.emit("sourceError", error);
      } finally {
        this.#schedule();
      }
    }, this.#pollIntervalMs);
  }

  #poll() {
    const highWaterId = Number(this.#database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM logs").get().id);
    const selectEvents = this.#database.prepare(`
      SELECT id, process_uuid, feedback_log_body
      FROM logs
      WHERE id > ? AND id <= ? AND target = ?
        AND feedback_log_body LIKE 'received realtime conversation event event=%Transcript%'
      ORDER BY id
      LIMIT ?
    `);

    while (this.#cursor < highWaterId) {
      const rows = selectEvents.all(this.#cursor, highWaterId, REALTIME_TARGET, this.#batchSize);
      for (const row of rows) {
        this.#cursor = Number(row.id);
        const event = parseCodexVoiceTranscriptEvent(row.feedback_log_body);
        if (!event) continue;

        if (event.type === "user_delta") {
          if (!this.#userSpeechActive) {
            this.emit("userSpeechStarted", { processUuid: row.process_uuid });
          }
          this.#userSpeechActive = true;
          this.#assistantInterrupted = this.#activeProcessUuid !== null;
          continue;
        }

        if (event.type === "delta") {
          if (!this.#activeProcessUuid || this.#assistantInterrupted) {
            this.#activeProcessUuid = row.process_uuid;
            this.#assistantInterrupted = false;
            this.emit("assistantResponseStarted", { processUuid: row.process_uuid });
          }
          this.#userSpeechActive = false;
          if (row.process_uuid === this.#activeProcessUuid) {
            this.emit("assistantTextDelta", { text: event.text, processUuid: row.process_uuid });
          }
          continue;
        }

        if (!this.#activeProcessUuid) {
          this.#activeProcessUuid = row.process_uuid;
          this.emit("assistantResponseStarted", { processUuid: row.process_uuid });
        }
        if (row.process_uuid === this.#activeProcessUuid) {
          this.emit("assistantTextDone", { text: event.text, processUuid: row.process_uuid });
          this.#activeProcessUuid = null;
          this.#assistantInterrupted = false;
        }
      }
      if (rows.length < this.#batchSize) this.#cursor = highWaterId;
    }
  }
}
