import { EventEmitter } from "node:events";

export const CONSOLE_ACTION = Object.freeze({
  REFRESH: "refresh",
  SET_EXPRESSION: "setExpression",
  SET_LED: "setLed",
  SET_HEAD: "setHead",
  CELEBRATE: "celebrate",
});

const EXPRESSIONS = new Set(["neutral", "happy", "angry", "sad", "doubtful"]);
const MAX_LED_CHANNEL = 168;
const HEAD_LIMITS = Object.freeze({ yaw: [-45, 45], pitch: [0, 45], speed: [100, 300] });
const DEFAULT_STATUS_REFRESH_MS = 60_000;
const LED_COLORS = Object.freeze({
  waiting: { red: 48, green: 32, blue: 0 },
  listening: { red: 0, green: 48, blue: 0 },
  playing: { red: 0, green: 0, blue: 48 },
  fault: { red: 48, green: 0, blue: 0 },
});

function now() { return new Date().toISOString(); }
function clone(value) { return structuredClone(value); }
function validInt(value, [minimum, maximum]) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function batteryStatus(device) {
  const battery = device?.battery;
  if (!Number.isInteger(battery?.level) || battery.level < 0 || battery.level > 100 || typeof battery.charging !== "boolean") {
    return { availability: "unavailable", level: null, charging: null, updatedAt: now(), source: "self.get_device_status" };
  }
  return { availability: "available", level: battery.level, charging: battery.charging, updatedAt: now(), source: "self.get_device_status" };
}

function derivedLed(state) {
  let phase = "waiting";
  if (["error", "degraded"].includes(state.health.runtime)) phase = "fault";
  else if (state.voice.phase === "speaking") phase = "playing";
  else if (state.connection.phase === "connected" && state.health.runtime === "running") phase = "listening";
  return { availability: "derived", phase, rgb: LED_COLORS[phase], source: "runtime_state" };
}

export class StackchanConsoleController extends EventEmitter {
  #runtime;
  #refreshTimer = null;
  #refreshInFlight = null;
  #refreshIntervalMs;
  #state = {
    revision: 0,
    connection: { phase: "offline", deviceId: null, sessionId: null, lastSeen: null },
    voice: { phase: "idle", subtitle: { phase: "unavailable", detail: null } },
    robot: {
      expression: "neutral", head: null,
      led: { availability: "derived", phase: "waiting", rgb: LED_COLORS.waiting, source: "runtime_state" },
      battery: { availability: "unavailable", level: null, charging: null, updatedAt: null, source: "self.get_device_status" },
    },
    health: { runtime: "not_started", lastError: null },
    speaker: { volume: null, pending: false, verified: false, error: null },
  };

  constructor({ runtime, voiceStatus = null, ledArbiter = null, speakerVolume = null, subtitlePublication = null, refreshIntervalMs = DEFAULT_STATUS_REFRESH_MS }) {
    super();
    if (!runtime || typeof runtime.start !== "function" || !runtime.dock) {
      throw new TypeError("a XiaozhiDockRuntime-compatible runtime is required");
    }
    if (!Number.isInteger(refreshIntervalMs) || refreshIntervalMs < 1_000) throw new RangeError("refreshIntervalMs must be at least one second");
    this.#runtime = runtime;
    this.#refreshIntervalMs = refreshIntervalMs;
    runtime.on("authenticated", ({ deviceId, sessionId }) => this.#patch({
      connection: { phase: "connected", deviceId, sessionId, lastSeen: now() },
      health: { runtime: "running", lastError: null },
    }));
    runtime.on("authenticated", () => this.#refresh().catch((error) => this.#patch({ health: { runtime: "error", lastError: error.message } })));
    runtime.on("disconnected", () => this.#patch({ connection: { phase: "disconnected", sessionId: null } }));
    runtime.on("speaking", (speaking) => this.#patch({ voice: { phase: speaking ? "speaking" : "idle" } }));
    runtime.on("subtitleWaiting", () => this.#patch({ voice: { subtitle: { phase: "waiting", detail: null } } }));
    runtime.on("subtitleFailOpen", ({ waitMs }) => this.#patch({ voice: { subtitle: { phase: "degraded", detail: `subtitle wait exceeded ${waitMs} ms` } } }));
    runtime.on("subtitleLate", () => this.#patch({ voice: { subtitle: { phase: "synced", detail: null } } }));
    runtime.on("runtimeError", (error) => this.#patch({ health: { runtime: "error", lastError: error.message } }));
    runtime.on("brokerExit", ({ code, signal }) => this.#patch({ health: { runtime: "degraded", lastError: `WASAPI broker exited (${code ?? signal ?? "unknown"})` } }));
    voiceStatus?.on("transition", ({ next }) => this.#patch({ voice: { phase: next } }));
    ledArbiter?.on("applied", ({ red, green, blue, source }) => this.#patch({ robot: { led: { availability: "confirmed", rgb: { red, green, blue }, source, manualOverride: ledArbiter.manualOverride } } }));
    ledArbiter?.on("manualSet", () => this.#patch({ robot: { led: { ...this.#state.robot.led, manualOverride: ledArbiter.manualOverride } } }));
    ledArbiter?.on("manualCleared", () => this.#patch({ robot: { led: { ...this.#state.robot.led, manualOverride: null } } }));
    speakerVolume?.on("state", (speaker) => this.#patch({ speaker: { ...this.#state.speaker, ...speaker } }));
    if (subtitlePublication) {
      if (typeof subtitlePublication.on !== "function" || !subtitlePublication.current) throw new TypeError("subtitle publication must expose current state and update events");
      this.#patch({ voice: { subtitle: subtitlePublication.current } });
      subtitlePublication.on("update", (subtitle) => this.#patch({ voice: { subtitle } }));
    }
  }

  get state() { return clone(this.#state); }

  async start() {
    this.#patch({ health: { runtime: "starting", lastError: null } });
    try {
      const address = await this.#runtime.start();
      this.#patch({ health: { runtime: "running", lastError: null } });
      this.#refreshTimer = setInterval(() => this.#refresh().catch((error) => this.#patch({ health: { runtime: "error", lastError: error.message } })), this.#refreshIntervalMs);
      return address;
    } catch (error) {
      this.#patch({ health: { runtime: "error", lastError: error.message } });
      throw error;
    }
  }

  async stop() {
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    this.#refreshTimer = null;
    await this.#runtime.stop();
    this.#patch({ health: { runtime: "stopped", lastError: null } });
  }

  async dispatch(action, input = {}) {
    switch (action) {
      case CONSOLE_ACTION.REFRESH: return this.#refresh();
      case CONSOLE_ACTION.SET_EXPRESSION: return this.#setExpression(input);
      case CONSOLE_ACTION.SET_LED: return this.#setLed(input);
      case CONSOLE_ACTION.SET_HEAD: return this.#setHead(input);
      case CONSOLE_ACTION.CELEBRATE: return this.#celebrate(input);
      default: throw new TypeError("console action is not allowlisted");
    }
  }

  async #refresh() {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    this.#refreshInFlight = this.#readStatus();
    try { return await this.#refreshInFlight; }
    finally { this.#refreshInFlight = null; }
  }

  async #readStatus() {
    let status;
    try { status = await this.#runtime.dock.getStatus(); } catch (error) {
      if (/not authenticated/i.test(error.message)) {
        this.#patch({ connection: { phase: "disconnected", deviceId: null, sessionId: null, lastSeen: now() }, health: { runtime: "waiting_for_robot", lastError: null } });
        return this.state;
      }
      throw error;
    }
    const head = await this.#runtime.dock.getHead().catch(() => null);
    this.#patch({
      connection: { phase: "connected", deviceId: status.device_id, sessionId: status.session_id, lastSeen: now() },
      robot: { head, battery: batteryStatus(status.device) },
      health: { runtime: "running", lastError: null },
    });
    return this.state;
  }

  async #setExpression({ expression }) {
    if (!EXPRESSIONS.has(expression)) throw new RangeError("expression is not allowlisted");
    await this.#runtime.dock.setExpression(expression);
    this.#patch({ robot: { expression } });
    return this.state;
  }

  async #setLed({ red, green, blue }) {
    for (const value of [red, green, blue]) if (!validInt(value, [0, MAX_LED_CHANNEL])) throw new RangeError("LED channels must be integers from 0 through 168");
    await this.#runtime.dock.setLed(red, green, blue);
    this.#patch({ robot: { led: { red, green, blue } } });
    return this.state;
  }

  async #setHead({ yaw, pitch, speed = 180 }) {
    if (!validInt(yaw, HEAD_LIMITS.yaw) || !validInt(pitch, HEAD_LIMITS.pitch) || !validInt(speed, HEAD_LIMITS.speed)) {
      throw new RangeError("head target is outside the console safety envelope");
    }
    await this.#runtime.dock.setHead(yaw, pitch, speed);
    this.#patch({ robot: { head: { yaw, pitch, speed, source: "commanded" } } });
    return this.state;
  }

  async #celebrate({ style = "cheer", duration_ms = 4000, intensity = 2, sound = false } = {}) {
    if (style !== "cheer" || !validInt(duration_ms, [3000, 5000]) || !validInt(intensity, [1, 3]) || typeof sound !== "boolean") {
      throw new RangeError("celebrate request is outside the console safety envelope");
    }
    await this.#runtime.dock.celebrate({ style, duration_ms, intensity, sound });
    return this.state;
  }

  #patch(partial) {
    for (const [key, value] of Object.entries(partial)) this.#state[key] = { ...this.#state[key], ...value };
    if (this.#state.robot.led.availability !== "confirmed") this.#state.robot = { ...this.#state.robot, led: derivedLed(this.#state) };
    this.#state.revision += 1;
    this.emit("state", this.state);
  }
}
