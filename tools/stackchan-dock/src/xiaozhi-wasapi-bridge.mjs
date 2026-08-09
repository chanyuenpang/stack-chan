import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";

export const WASAPI_BROKER_MAX_PACKET_BYTES = 1_500;

export function encodeBrokerPacket(packet) {
  const payload = Buffer.from(packet ?? []);
  if (payload.length > WASAPI_BROKER_MAX_PACKET_BYTES) {
    throw new RangeError("WASAPI broker packet exceeds 1500 bytes");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class BrokerPacketParser {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (incoming.length === 0) return [];
    this.#buffer = this.#buffer.length === 0 ? incoming : Buffer.concat([this.#buffer, incoming]);
    const packets = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length > WASAPI_BROKER_MAX_PACKET_BYTES) {
        throw new RangeError("WASAPI broker packet exceeds 1500 bytes");
      }
      if (this.#buffer.length < 4 + length) break;
      packets.push(this.#buffer.subarray(4, 4 + length));
      this.#buffer = this.#buffer.subarray(4 + length);
    }
    return packets;
  }

  finish() {
    if (this.#buffer.length !== 0) throw new Error("truncated WASAPI broker frame");
  }
}

export class XiaozhiWasapiBroker extends EventEmitter {
  #binaryPath;
  #pid;
  #renderDevice;
  #spawn;
  #child = null;
  #parser = new BrokerPacketParser();
  #stderr = "";

  constructor({ binaryPath, pid, renderDevice = "CABLE Input", spawnImpl = spawn } = {}) {
    super();
    if (typeof binaryPath !== "string" || binaryPath.length === 0) throw new TypeError("binaryPath is required");
    if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("pid must be a positive integer");
    if (typeof renderDevice !== "string" || renderDevice.length === 0) throw new TypeError("renderDevice is required");
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
    this.#binaryPath = binaryPath;
    this.#pid = pid;
    this.#renderDevice = renderDevice;
    this.#spawn = spawnImpl;
  }

  get running() {
    return this.#child !== null && this.#child.exitCode === null;
  }

  get stderr() {
    return this.#stderr;
  }

  start() {
    if (this.#child) throw new Error("WASAPI broker is already started");
    const child = this.#spawn(this.#binaryPath, [
      "--pid", String(this.#pid),
      "--render-device", this.#renderDevice,
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.#child = child;
    child.stdout.on("data", (chunk) => {
      try {
        for (const packet of this.#parser.push(chunk)) {
          if (packet.length === 0) this.emit("activityStop");
          else this.emit("downlinkOpus", Buffer.from(packet));
        }
      } catch (error) {
        this.emit("error", error);
        child.kill();
      }
    });
    child.stdout.on("end", () => {
      try {
        this.#parser.finish();
      } catch (error) {
        this.emit("error", error);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = Buffer.from(chunk).toString("utf8");
      this.#stderr = (this.#stderr + text).slice(-64 * 1024);
      this.emit("diagnostic", text);
    });
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code, signal) => {
      this.#child = null;
      this.emit("exit", { code, signal });
    });
    return child;
  }

  async writeMicrophoneOpus(opus) {
    const packet = Buffer.from(opus ?? []);
    if (packet.length === 0) throw new TypeError("microphone Opus packet must not be empty");
    const child = this.#child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) throw new Error("WASAPI broker is not running");
    if (!child.stdin.write(encodeBrokerPacket(packet))) await once(child.stdin, "drain");
  }

  async stop() {
    const child = this.#child;
    if (!child) return;
    const exited = once(child, "exit");
    child.stdin.end();
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!graceful && child.exitCode === null) {
      child.kill();
      await exited;
    }
  }
}

export class XiaozhiWasapiBridge extends EventEmitter {
  #server;
  #broker;
  #speaking = false;
  #listeners = [];

  constructor({ server, broker } = {}) {
    super();
    if (!server || typeof server.sendDownlinkOpus !== "function") throw new TypeError("server is required");
    if (!broker || typeof broker.writeMicrophoneOpus !== "function") throw new TypeError("broker is required");
    this.#server = server;
    this.#broker = broker;
  }

  attach() {
    if (this.#listeners.length > 0) throw new Error("WASAPI bridge is already attached");
    this.#listen(this.#server, "microphoneOpus", ({ opus }) => {
      this.#broker.writeMicrophoneOpus(opus).catch((error) => this.emit("error", error));
    });
    this.#listen(this.#server, "disconnected", () => { this.#speaking = false; });
    this.#listen(this.#broker, "downlinkOpus", (opus) => {
      try {
        if (!this.#speaking) {
          this.#server.sendTtsStart();
          this.#speaking = true;
          this.emit("speaking", true);
        }
        this.#server.sendDownlinkOpus(opus);
      } catch (error) {
        this.emit("error", error);
      }
    });
    this.#listen(this.#broker, "activityStop", () => {
      if (!this.#speaking) return;
      try {
        this.#server.sendTtsStop();
      } catch (error) {
        this.emit("error", error);
      } finally {
        this.#speaking = false;
        this.emit("speaking", false);
      }
    });
    return this;
  }

  detach() {
    for (const [emitter, event, listener] of this.#listeners) emitter.off(event, listener);
    this.#listeners = [];
    this.#speaking = false;
  }

  #listen(emitter, event, listener) {
    emitter.on(event, listener);
    this.#listeners.push([emitter, event, listener]);
  }
}
