import { EventEmitter } from "node:events";

import { COMMAND, DeviceCommandError } from "./protocol.mjs";
import { DeviceStateStore } from "./state-store.mjs";

export const WIFI_HEAD_MOTION_DISABLED_CODE = "head_motion_disabled";
const INITIAL_STATUS_ATTEMPTS = 3;
const INITIAL_STATUS_RETRY_MS = 100;

export function normalizeWifiStatus(status, deviceId) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new TypeError("Wi-Fi status must be an object");
  }
  if (status.device !== "stackchan-wifi-companion" || status.protocol_version !== 1) {
    throw new TypeError("Wi-Fi status identity or protocol version is incompatible");
  }
  if (!Number.isSafeInteger(status.event_sequence) || status.event_sequence < 0) {
    throw new TypeError("Wi-Fi status event_sequence must be a non-negative integer");
  }
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw new TypeError("authenticated Wi-Fi device id is required");
  }
  return {
    ...structuredClone(status),
    device: "stackchan-codex-companion",
    connection: {
      transport: "wifi",
      connected: true,
      device_id: deviceId,
    },
  };
}

export class WifiStackchanDock extends EventEmitter {
  #receiver;
  #transport;
  #store = new DeviceStateStore();
  #running = false;
  #deviceId = null;
  #generation = 0;
  #handshaking = false;
  #pendingEvents = [];
  #resyncPromise = null;

  constructor({ receiver } = {}) {
    super();
    if (!receiver || typeof receiver !== "object" || !receiver.transport) {
      throw new TypeError("Wi-Fi Audio receiver is required");
    }
    this.#receiver = receiver;
    this.#transport = receiver.transport;
  }

  get running() { return this.#running; }
  get connected() { return this.#running && this.#transport.connected; }
  get state() { return this.#store.snapshot(); }

  async start() {
    if (this.#running) return;
    this.#running = true;
    this.#receiver.on("authenticated", this.#onAuthenticated);
    this.#receiver.on("protocolError", this.#onProtocolError);
    this.#transport.on("event", this.#onEvent);
    this.#transport.on("protocolError", this.#onProtocolError);
    this.#transport.on("close", this.#onClose);
    this.emit("lifecycle", { state: "waiting_for_wifi_robot" });
  }

  async stop() {
    if (!this.#running) return;
    this.#running = false;
    this.#generation += 1;
    this.#receiver.off("authenticated", this.#onAuthenticated);
    this.#receiver.off("protocolError", this.#onProtocolError);
    this.#transport.off("event", this.#onEvent);
    this.#transport.off("protocolError", this.#onProtocolError);
    this.#transport.off("close", this.#onClose);
    this.#pendingEvents = [];
    this.#handshaking = false;
    this.emit("lifecycle", { state: "stopped" });
  }

  async getStatus() { return this.#typedRequest(COMMAND.GET_STATUS, {}); }
  async setAudioEndpoints(options) { return this.#typedRequest(COMMAND.SET_AUDIO, options); }
  async setExpression(expression) { return this.#typedRequest(COMMAND.SET_EXPRESSION, { expression }); }
  async setTalking(enabled) { return this.#typedRequest(COMMAND.SET_TALKING, { enabled }); }
  async setLed(red, green, blue) { return this.#typedRequest(COMMAND.SET_LED, { red, green, blue }); }
  async getHead() { return this.#typedRequest(COMMAND.GET_HEAD, {}); }
  async setHead() {
    throw new DeviceCommandError(
      WIFI_HEAD_MOTION_DISABLED_CODE,
      "Wi-Fi head motion is disabled until the servo power-loss bug is resolved",
    );
  }

  async #typedRequest(command, args) {
    if (!this.connected || !this.#deviceId) throw new Error("Stack-chan Wi-Fi Dock is not connected");
    const result = await this.#transport.request(command, args);
    if (command === COMMAND.GET_STATUS) {
      return this.#publishSnapshot(result, "api");
    }
    if (command === COMMAND.SET_AUDIO && this.#store.snapshot()) {
      const current = this.#store.snapshot();
      this.#publishSnapshot({ ...current, device: "stackchan-wifi-companion", audio: result }, "api");
    }
    return result;
  }

  async #requestInitialStatus(generation) {
    let lastError;
    for (let attempt = 1; attempt <= INITIAL_STATUS_ATTEMPTS; attempt += 1) {
      try {
        return await this.#transport.request(COMMAND.GET_STATUS, {});
      } catch (error) {
        lastError = error;
        if (!this.#running || generation !== this.#generation || !this.#transport.connected ||
            attempt === INITIAL_STATUS_ATTEMPTS) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, INITIAL_STATUS_RETRY_MS));
      }
    }
    throw lastError;
  }

  #onAuthenticated = ({ deviceId, remoteAddress }) => {
    if (!this.#running) return;
    const generation = ++this.#generation;
    this.#deviceId = deviceId;
    this.#handshaking = true;
    this.#pendingEvents = [];
    this.emit("lifecycle", { state: "synchronizing", deviceId, remoteAddress });
    this.#requestInitialStatus(generation)
      .then((status) => {
        if (!this.#running || generation !== this.#generation) return;
        this.#publishSnapshot(status, "handshake");
        for (const event of this.#pendingEvents.sort((a, b) => a.seq - b.seq)) {
          this.#applyEvent(event);
        }
        this.#pendingEvents = [];
        this.#handshaking = false;
        this.emit("connected", { deviceId, remoteAddress, state: this.state });
        this.emit("lifecycle", { state: "connected", deviceId, remoteAddress });
      })
      .catch((error) => {
        if (!this.#running || generation !== this.#generation) return;
        this.#handshaking = false;
        this.emit("dockError", error);
      });
  };

  #onClose = (error) => {
    if (!this.#running) return;
    this.#generation += 1;
    this.#deviceId = null;
    this.#handshaking = false;
    this.#pendingEvents = [];
    this.emit("lifecycle", { state: "disconnected" });
    if (error) this.emit("transportError", error);
  };

  #onProtocolError = (error) => this.emit("protocolError", error);

  #onEvent = (event) => {
    if (!this.#running) return;
    if (this.#handshaking || !this.#store.snapshot() || this.#resyncPromise) {
      this.#pendingEvents.push(event);
      return;
    }
    this.#applyEvent(event);
  };

  #applyEvent(event) {
    const outcome = this.#store.applyEvent(event);
    if (outcome.applied) {
      this.emit("deviceEvent", event);
      this.emit("state", { source: "event", state: outcome.state });
    } else if (outcome.needsResync) {
      this.#pendingEvents.push(event);
      this.#scheduleResync();
    }
  }

  #scheduleResync() {
    if (this.#resyncPromise || !this.connected || !this.#deviceId) return;
    const generation = this.#generation;
    this.#resyncPromise = this.#transport.request(COMMAND.GET_STATUS, {})
      .then((status) => {
        if (!this.#running || generation !== this.#generation) return;
        this.#publishSnapshot(status, "sequence_resync");
        const pending = this.#pendingEvents.sort((a, b) => a.seq - b.seq);
        this.#pendingEvents = [];
        for (const event of pending) {
          const outcome = this.#store.applyEvent(event);
          if (outcome.applied) {
            this.emit("deviceEvent", event);
            this.emit("state", { source: "event_after_resync", state: outcome.state });
          }
        }
      })
      .catch((error) => this.emit("dockError", error))
      .finally(() => { this.#resyncPromise = null; });
  }

  #publishSnapshot(status, source) {
    const state = this.#store.replaceFromStatus(normalizeWifiStatus(status, this.#deviceId));
    this.emit("state", { source, state });
    return state;
  }
}
