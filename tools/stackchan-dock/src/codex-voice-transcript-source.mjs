import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REALTIME_TARGET = "codex_core::realtime_conversation";
const REALTIME_WIRE_TARGET = "codex_api::realtime_websocket::wire";
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

// This is received from the same Realtime session that feeds Codex audio.
// Prefer the correlated turn stream; output_transcript.added remains only as a
// compatibility fallback for logs that do not contain turn events.
export function parseCodexRealtimeWireTranscriptEvent(body) {
  if (typeof body !== "string") return null;
  const encoded = body.match(/^realtime websocket event: (\{.*\})$/s);
  if (!encoded) return null;
  let event;
  try { event = JSON.parse(encoded[1]); } catch { return null; }
  if (event?.type === "turn.created") {
    const turn = event.turn;
    const text = turn?.transcript;
    if (typeof turn?.role !== "string" || typeof turn.id !== "string" || !turn.id || typeof text !== "string" || !text.isWellFormed()) return null;
    return { type: "created", role: turn.role, text, turnId: turn.id,
      startMs: Number.isFinite(turn.start_ms) ? turn.start_ms : undefined,
      endMs: Number.isFinite(turn.end_ms) ? turn.end_ms : undefined };
  }
  if (event?.type === "turn.delta") {
    if (typeof event.turn_id !== "string" || !event.turn_id || typeof event.delta !== "string" || !event.delta.isWellFormed() || event.delta.length === 0) return null;
    return { type: "delta", text: event.delta, turnId: event.turn_id,
      startMs: Number.isFinite(event.start_ms) ? event.start_ms : undefined,
      endMs: Number.isFinite(event.end_ms) ? event.end_ms : undefined };
  }
  if (event?.type === "turn.done") {
    const turn = event.turn;
    if (typeof turn?.role !== "string" || typeof turn.id !== "string" || !turn.id) return null;
    const text = typeof turn.transcript === "string" && turn.transcript.isWellFormed() ? turn.transcript : "";
    return { type: "done", role: turn.role, text, turnId: turn.id,
      startMs: Number.isFinite(turn.start_ms) ? turn.start_ms : undefined,
      endMs: Number.isFinite(turn.end_ms) ? turn.end_ms : undefined };
  }
  if (event?.type !== "output_transcript.added") return null;
  const text = event.item?.text;
  if (typeof text !== "string" || !text.isWellFormed() || text.length === 0) return null;
  return { type: "delta", text, itemId: typeof event.item?.id === "string" ? event.item.id : undefined,
    startMs: Number.isFinite(event.start_ms) ? event.start_ms : undefined,
    endMs: Number.isFinite(event.end_ms) ? event.end_ms : undefined };
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
  #wireAvailable = false;
  #wireTurnAvailable = false;
  #activeWireTurnId = null;
  #assistantWireTurnIds = new Set();
  #rejectedWireTurnIds = new Set();
  #cancelledWireTurnIds = new Set();
  #trace = false;

  constructor({
    databasePath = join(homedir(), ".codex", "logs_2.sqlite"),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    trace = false,
  } = {}) {
    super();
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
      throw new RangeError("pollIntervalMs must be a positive number");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError("batchSize must be a positive integer");
    }
    if (typeof trace !== "boolean") throw new TypeError("trace must be a boolean");
    this.#databasePath = databasePath;
    this.#pollIntervalMs = pollIntervalMs;
    this.#batchSize = batchSize;
    this.#trace = trace;
  }

  get running() { return this.#running; }
  get databasePath() { return this.#databasePath; }

  start() {
    if (this.#running) return;
    this.#database = new DatabaseSync(this.#databasePath, { readOnly: true });
    this.#validateSchema();
    this.#cursor = Number(this.#database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM logs").get().id);
    this.#wireAvailable = Number(this.#database.prepare(`SELECT COUNT(*) AS count FROM logs WHERE target = ? AND feedback_log_body LIKE '%output_transcript.added%'`).get(REALTIME_WIRE_TARGET).count) > 0;
    this.#wireTurnAvailable = Number(this.#database.prepare(`SELECT COUNT(*) AS count FROM logs WHERE target = ? AND feedback_log_body LIKE '%turn.delta%'`).get(REALTIME_WIRE_TARGET).count) > 0;
    this.#running = true;
    this.emit("started", { databasePath: this.#databasePath, cursor: this.#cursor });
    this.#emitTrace("source_started", { cursor: this.#cursor, wireAvailable: this.#wireAvailable });
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
    this.#activeWireTurnId = null;
    this.#assistantWireTurnIds.clear();
    this.#rejectedWireTurnIds.clear();
    this.#cancelledWireTurnIds.clear();
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
      WHERE id > ? AND id <= ? AND (
        (target = ? AND feedback_log_body LIKE 'received realtime conversation event event=%Transcript%')
        OR (target = ? AND feedback_log_body LIKE 'realtime websocket event: %')
      )
      ORDER BY id
      LIMIT ?
    `);

    while (this.#cursor < highWaterId) {
      const rows = selectEvents.all(this.#cursor, highWaterId, REALTIME_TARGET, REALTIME_WIRE_TARGET, this.#batchSize);
      for (const row of rows) {
        this.#cursor = Number(row.id);
        const wireEvent = parseCodexRealtimeWireTranscriptEvent(row.feedback_log_body);
        if (wireEvent) {
          this.#wireAvailable = true;
          if (wireEvent.turnId) {
            this.#wireTurnAvailable = true;
            this.#acceptAssistantWireTurnEvent(wireEvent, row.process_uuid, row.id);
            continue;
          }
          if (this.#wireTurnAvailable) continue;
          this.#acceptAssistantDelta(wireEvent, row.process_uuid, "realtime-wire", row.id);
          continue;
        }
        const event = parseCodexVoiceTranscriptEvent(row.feedback_log_body);
        if (!event) continue;

        if (event.type === "user_delta") {
          if (!this.#userSpeechActive) {
            this.emit("userSpeechStarted", { processUuid: row.process_uuid });
          }
          this.#userSpeechActive = true;
          this.#assistantInterrupted = this.#activeProcessUuid !== null;
          if (this.#activeWireTurnId) {
            this.#cancelledWireTurnIds.add(this.#activeWireTurnId);
            this.#assistantWireTurnIds.delete(this.#activeWireTurnId);
            this.#activeWireTurnId = null;
          }
          this.#emitTrace("user_delta", {
            rowId: row.id,
            processUuid: row.process_uuid,
            activeProcessUuid: this.#activeProcessUuid,
            wireAvailable: this.#wireAvailable,
            marksInterrupted: this.#assistantInterrupted,
            textLength: event.text.length,
          });
          continue;
        }

        if (event.type === "delta") {
          if (this.#wireAvailable) continue;
          if (!this.#activeProcessUuid || this.#assistantInterrupted) {
            const reason = !this.#activeProcessUuid ? "initial" : "input_interrupt";
            this.#activeProcessUuid = row.process_uuid;
            this.#assistantInterrupted = false;
            this.emit("assistantResponseStarted", { processUuid: row.process_uuid, reason });
            this.#emitTrace("assistant_response_started", { rowId: row.id, processUuid: row.process_uuid, reason, source: "conversation" });
          }
          this.#userSpeechActive = false;
          if (row.process_uuid === this.#activeProcessUuid) {
            this.emit("assistantTextDelta", { text: event.text, processUuid: row.process_uuid });
          }
          continue;
        }

        if (this.#wireAvailable) continue;
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

  #acceptAssistantDelta(event, processUuid, source, rowId) {
    if (!this.#activeProcessUuid || this.#assistantInterrupted || processUuid !== this.#activeProcessUuid) {
      const reason = !this.#activeProcessUuid ? "initial" : this.#assistantInterrupted ? "input_interrupt" : "process_change";
      this.#activeProcessUuid = processUuid;
      this.#assistantInterrupted = false;
      this.emit("assistantResponseStarted", { processUuid, source, reason });
      this.#emitTrace("assistant_response_started", { rowId, processUuid, reason, source, itemId: event.itemId });
    }
    this.#userSpeechActive = false;
    this.emit("assistantTextDelta", { text: event.text, processUuid, source, itemId: event.itemId, startMs: event.startMs, endMs: event.endMs });
    this.#emitTrace("assistant_delta", { rowId, processUuid, source, itemId: event.itemId, startMs: event.startMs, endMs: event.endMs, textLength: event.text.length });
  }

  #acceptAssistantWireTurnEvent(event, processUuid, rowId) {
    if (event.type === "created") {
      if (event.role !== "assistant") {
        this.#rejectedWireTurnIds.add(event.turnId);
        if (event.role === "user") this.emit("userTurnStarted", { processUuid, turnId: event.turnId });
        this.#emitTrace("assistant_turn_ignored", { rowId, processUuid, turnId: event.turnId, reason: "non_assistant_role", role: event.role });
        return;
      }
      this.#assistantWireTurnIds.add(event.turnId);
    }
    if (event.type === "done" && event.role !== "assistant") {
      if (event.role === "user" && this.#rejectedWireTurnIds.has(event.turnId)) {
        this.emit("userTurnDone", { processUuid, turnId: event.turnId, startMs: event.startMs, endMs: event.endMs });
        this.#emitTrace("user_turn_done", { rowId, processUuid, turnId: event.turnId, startMs: event.startMs, endMs: event.endMs });
      } else {
        this.#emitTrace("assistant_done_ignored", { rowId, processUuid, turnId: event.turnId, reason: "non_assistant_turn", role: event.role });
      }
      return;
    }
    if (!this.#assistantWireTurnIds.has(event.turnId)) {
      this.#emitTrace(event.type === "done" ? "assistant_done_ignored" : "assistant_delta_ignored", {
        rowId, processUuid, turnId: event.turnId,
        reason: this.#rejectedWireTurnIds.has(event.turnId) ? "non_assistant_turn" : "unconfirmed_turn",
      });
      return;
    }
    if (event.type === "done") {
      if (event.turnId !== this.#activeWireTurnId || this.#cancelledWireTurnIds.has(event.turnId)) {
        this.#emitTrace("assistant_done_ignored", { rowId, processUuid, turnId: event.turnId, activeTurnId: this.#activeWireTurnId });
        return;
      }
      this.emit("assistantTextDone", { text: event.text, processUuid, source: "realtime-wire-turn", turnId: event.turnId });
      this.#emitTrace("assistant_response_done", { rowId, processUuid, turnId: event.turnId, textLength: event.text.length });
      this.#activeWireTurnId = null;
      this.#assistantWireTurnIds.delete(event.turnId);
      return;
    }
    if (this.#cancelledWireTurnIds.has(event.turnId)) {
      this.#emitTrace("assistant_delta_ignored", { rowId, processUuid, turnId: event.turnId, reason: "cancelled_turn" });
      return;
    }
    if (event.turnId !== this.#activeWireTurnId) {
      const reason = this.#activeWireTurnId ? "turn_change" : "initial";
      if (this.#activeWireTurnId) {
        this.#cancelledWireTurnIds.add(this.#activeWireTurnId);
        this.#assistantWireTurnIds.delete(this.#activeWireTurnId);
      }
      this.#activeWireTurnId = event.turnId;
      this.#assistantInterrupted = false;
      this.emit("assistantResponseStarted", { processUuid, source: "realtime-wire-turn", turnId: event.turnId, reason });
      this.#emitTrace("assistant_response_started", { rowId, processUuid, source: "realtime-wire-turn", turnId: event.turnId, reason });
    }
    this.#userSpeechActive = false;
    this.emit("assistantTextDelta", { text: event.text, processUuid, source: "realtime-wire-turn", turnId: event.turnId, startMs: event.startMs, endMs: event.endMs });
    this.#emitTrace(event.type === "created" ? "assistant_turn_created" : "assistant_delta", { rowId, processUuid, source: "realtime-wire-turn", turnId: event.turnId, startMs: event.startMs, endMs: event.endMs, textLength: event.text.length });
  }

  #emitTrace(event, details) {
    if (this.#trace) this.emit("lifecycleTrace", { source: "transcript", event, at: Date.now(), ...details });
  }
}
