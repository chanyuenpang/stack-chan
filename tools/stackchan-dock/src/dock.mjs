import { EventEmitter } from "node:events";
import { COMMAND } from "./protocol.mjs";
import { discoverCompanionPort, openSerialTransport } from "./serial-adapter.mjs";
import { DeviceStateStore } from "./state-store.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class StackchanDock extends EventEmitter {
  #discover;
  #openTransport;
  #sleep;
  #backoff;
  #transportOptions;
  #preferredSerial;
  #transport = null;
  #store = new DeviceStateStore();
  #running = false;
  #stopping = false;
  #loopPromise = null;
  #disconnectResolve = null;
  #resyncPromise = null;
  #pendingEvents = [];
  #handshaking = false;

  constructor({
    discover = discoverCompanionPort,
    openTransport = openSerialTransport,
    sleep = delay,
    preferredSerial,
    backoff = { initialMs: 100, maximumMs: 5000, factor: 2 },
    transportOptions = {},
  } = {}) {
    super();
    this.#discover = discover;
    this.#openTransport = openTransport;
    this.#sleep = sleep;
    this.#preferredSerial = preferredSerial;
    this.#backoff = backoff;
    this.#transportOptions = transportOptions;
  }

  get running() { return this.#running; }
  get connected() { return this.#transport !== null; }
  get preferredSerial() { return this.#preferredSerial; }
  get state() { return this.#store.snapshot(); }

  start() {
    if (this.#running) return this.#loopPromise;
    this.#running = true;
    this.#stopping = false;
    this.#loopPromise = this.#run();
    return this.#loopPromise;
  }

  async stop() {
    this.#stopping = true;
    this.#disconnectResolve?.();
    await this.#transport?.close().catch(() => {});
    await this.#loopPromise;
  }

  async getStatus() { return this.#typedRequest(COMMAND.GET_STATUS, {}); }
  async setAudioEndpoints(options) { return this.#typedRequest(COMMAND.SET_AUDIO, options); }
  async setExpression(expression) { return this.#typedRequest(COMMAND.SET_EXPRESSION, { expression }); }
  async setTalking(enabled) { return this.#typedRequest(COMMAND.SET_TALKING, { enabled }); }
  async setSpeech(text) { return this.#typedRequest(COMMAND.SET_SPEECH, { text }); }
  async clearSpeech() { return this.#typedRequest(COMMAND.CLEAR_SPEECH, {}); }
  async setLed(red, green, blue) { return this.#typedRequest(COMMAND.SET_LED, { red, green, blue }); }
  async getHead() { return this.#typedRequest(COMMAND.GET_HEAD, {}); }
  async setHead(yaw, pitch, speed) { return this.#typedRequest(COMMAND.SET_HEAD, { yaw, pitch, speed }); }

  async #typedRequest(command, args) {
    if (!this.#transport) throw new Error("Stack-chan is not connected");
    const result = await this.#transport.request(command, args);
    if (command === COMMAND.GET_STATUS) this.#publishSnapshot(result, "api");
    if (command === COMMAND.SET_AUDIO && this.#store.snapshot()) {
      const current = this.#store.snapshot();
      this.#publishSnapshot({ ...current, audio: result }, "api");
    }
    return result;
  }

  async #run() {
    let backoffMs = this.#backoff.initialMs;
    while (!this.#stopping) {
      this.emit("lifecycle", { state: "discovering" });
      let transport = null;
      try {
        const device = await this.#discover({ preferredSerial: this.#preferredSerial });
        if (!device) {
          await this.#sleep(backoffMs);
          backoffMs = Math.min(this.#backoff.maximumMs, backoffMs * this.#backoff.factor);
          continue;
        }

        transport = await this.#openTransport(device, this.#transportOptions);
        this.#transport = transport;
        this.#handshaking = true;
        const disconnected = new Promise((resolve) => { this.#disconnectResolve = resolve; });
        transport.on("event", (event) => this.#handleEvent(event));
        transport.on("protocolError", (error) => this.emit("protocolError", error));
        transport.on("transportError", (error) => {
          this.emit("transportError", error);
          this.#disconnectResolve?.();
        });
        transport.once("close", () => this.#disconnectResolve?.());
        await transport.open();

        this.#pendingEvents = [];
        const status = await transport.request(COMMAND.GET_STATUS, {});
        this.#publishSnapshot(status, "handshake");
        for (const event of this.#pendingEvents.sort((a, b) => a.seq - b.seq)) this.#applyEvent(event);
        this.#pendingEvents = [];
        this.#handshaking = false;

        this.#preferredSerial = device.usbSerial ?? device.serialNumber ?? this.#preferredSerial;
        backoffMs = this.#backoff.initialMs;
        this.emit("connected", { device, state: this.state });
        this.emit("lifecycle", { state: "connected", device });
        await disconnected;
      } catch (error) {
        if (!this.#stopping) this.emit("dockError", error);
      } finally {
        this.#disconnectResolve = null;
        this.#handshaking = false;
        if (this.#transport === transport) this.#transport = null;
        await transport?.close().catch(() => {});
      }

      if (!this.#stopping) {
        this.emit("lifecycle", { state: "disconnected" });
        await this.#sleep(backoffMs);
        backoffMs = Math.min(this.#backoff.maximumMs, backoffMs * this.#backoff.factor);
      }
    }
    this.#running = false;
    this.emit("lifecycle", { state: "stopped" });
  }

  #handleEvent(event) {
    if (this.#handshaking || !this.#store.snapshot() || this.#resyncPromise) {
      this.#pendingEvents.push(event);
      return;
    }
    this.#applyEvent(event);
  }

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
    if (this.#resyncPromise || !this.#transport) return;
    const transport = this.#transport;
    this.#resyncPromise = (async () => {
      const status = await transport.request(COMMAND.GET_STATUS, {});
      if (transport !== this.#transport) return;
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
    })().catch((error) => {
      this.emit("dockError", error);
      this.#disconnectResolve?.();
    }).finally(() => { this.#resyncPromise = null; });
  }

  #publishSnapshot(status, source) {
    const state = this.#store.replaceFromStatus(status);
    this.emit("state", { source, state });
  }
}
