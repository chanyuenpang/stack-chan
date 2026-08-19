import { EventEmitter } from "node:events";

export const VOICE_STATUS = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  WAITING_RESPONSE: "waiting_response",
  RESPONSE_STARTED: "response_started_waiting_audio",
  SPEAKING: "speaking",
  DISCONNECTED: "disconnected",
});

const LED = Object.freeze({
  listening: Object.freeze({ red: 0, green: 168, blue: 0 }),
  waiting: Object.freeze({ red: 120, green: 0, blue: 168 }),
  speaking: Object.freeze({ red: 0, green: 0, blue: 168 }),
});

function requireEmitter(value, name) {
  if (!value || typeof value.on !== "function" || typeof value.off !== "function") {
    throw new TypeError(`${name} must be an EventEmitter`);
  }
}

// This is deliberately an *awaiting reply* indicator, not a thinking detector.
// The current Desktop Codex wire exposes turn lifecycle and real downlink audio,
// but no authoritative reasoning/thinking event.
export class CodexVoiceStatusIndicator extends EventEmitter {
  #dock;
  #transcripts;
  #runtime;
  #trace;
  #listeners = [];
  #phase = VOICE_STATUS.IDLE;
  #pendingUserTurnId = null;
  #ledPromise = Promise.resolve();

  constructor({ dock, transcripts, runtime, trace = null } = {}) {
    super();
    if (!dock || typeof dock.setLed !== "function") throw new TypeError("dock.setLed is required");
    requireEmitter(transcripts, "transcripts");
    requireEmitter(runtime, "runtime");
    if (trace !== null && typeof trace !== "function") throw new TypeError("trace must be a function when provided");
    this.#dock = dock;
    this.#transcripts = transcripts;
    this.#runtime = runtime;
    this.#trace = trace;
  }

  get phase() { return this.#phase; }

  attach() {
    if (this.#listeners.length) throw new Error("Codex voice status indicator is already attached");
    this.#listen(this.#transcripts, "userTurnStarted", ({ turnId }) => this.#onUserTurnStarted(turnId));
    this.#listen(this.#transcripts, "userSpeechStarted", () => this.#clearForUserInput("user_input_transcript"));
    this.#listen(this.#transcripts, "userTurnDone", ({ turnId }) => this.#onUserTurnDone(turnId));
    this.#listen(this.#transcripts, "assistantResponseStarted", ({ turnId }) => this.#onAssistantStarted(turnId));
    this.#listen(this.#runtime, "speaking", (speaking) => this.#onSpeaking(Boolean(speaking)));
    this.#listen(this.#runtime, "disconnected", () => this.#transition(VOICE_STATUS.DISCONNECTED, "robot_disconnected"));
    this.#listen(this.#runtime, "authenticated", () => {
      if (this.#phase === VOICE_STATUS.DISCONNECTED) this.#transition(VOICE_STATUS.LISTENING, "robot_authenticated");
    });
    return this;
  }

  detach() {
    for (const [emitter, event, listener] of this.#listeners) emitter.off(event, listener);
    this.#listeners = [];
  }

  #listen(emitter, event, listener) {
    emitter.on(event, listener);
    this.#listeners.push([emitter, event, listener]);
  }

  #onUserTurnStarted(turnId) {
    this.#pendingUserTurnId = null;
    this.#clearForUserInput("user_turn_created", turnId);
  }

  #clearForUserInput(reason, turnId = undefined) {
    // User input is a cancellation signal only. It must never create purple.
    if (this.#phase === VOICE_STATUS.WAITING_RESPONSE || this.#phase === VOICE_STATUS.RESPONSE_STARTED || this.#phase === VOICE_STATUS.SPEAKING) {
      this.#transition(VOICE_STATUS.LISTENING, reason, turnId);
    }
  }

  #onUserTurnDone(turnId) {
    this.#pendingUserTurnId = turnId;
    this.#transition(VOICE_STATUS.WAITING_RESPONSE, "matched_user_turn_done", turnId);
  }

  #onAssistantStarted(turnId) {
    if (this.#phase !== VOICE_STATUS.WAITING_RESPONSE && this.#phase !== VOICE_STATUS.RESPONSE_STARTED) return;
    this.#transition(VOICE_STATUS.RESPONSE_STARTED, "assistant_turn_created", turnId, this.#pendingUserTurnId);
  }

  #onSpeaking(speaking) {
    if (speaking) {
      this.#pendingUserTurnId = null;
      this.#transition(VOICE_STATUS.SPEAKING, "first_downlink_opus");
      return;
    }
    if (this.#phase === VOICE_STATUS.SPEAKING) this.#transition(VOICE_STATUS.LISTENING, "downlink_activity_stop");
  }

  #transition(next, reason, turnId = undefined, userTurnId = undefined) {
    const previous = this.#phase;
    if (previous === next) return;
    this.#phase = next;
    const details = { source: "voice_status", event: "transition", at: Date.now(), previous, next, reason,
      ...(turnId ? { turnId } : {}), ...(userTurnId ? { userTurnId } : {}) };
    this.#trace?.(details);
    this.emit("transition", details);

    const led = next === VOICE_STATUS.WAITING_RESPONSE || next === VOICE_STATUS.RESPONSE_STARTED
      ? LED.waiting
      : next === VOICE_STATUS.SPEAKING ? LED.speaking
        : next === VOICE_STATUS.LISTENING ? LED.listening : null;
    if (!led) return;
    // A disconnected Owner has no authenticated control channel. Recording the
    // state is useful, but sending a best-effort MCP command here would fake a
    // physical offline indication and can only create noisy failures.
    if ("connected" in this.#dock && !this.#dock.connected) {
      this.#trace?.({ source: "voice_status", event: "led_skipped", at: Date.now(), phase: next, reason, cause: "dock_not_authenticated" });
      return;
    }
    this.#ledPromise = this.#ledPromise
      .catch(() => {})
      .then(async () => {
        try {
          await this.#dock.setLed(led.red, led.green, led.blue);
          this.#trace?.({ source: "voice_status", event: "led_applied", at: Date.now(), phase: next, reason, ...led });
        } catch (error) {
          const details = { source: "voice_status", event: "led_error", at: Date.now(), phase: next, reason, message: error.message };
          this.#trace?.(details);
          this.emit("error", error);
        }
      });
  }
}
