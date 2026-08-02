import { EventEmitter } from "node:events";
import { DeviceCommandError, encodeRequest, parseFrame } from "./protocol.mjs";

function callPort(port, method, ...args) {
  return new Promise((resolve, reject) => {
    port[method](...args, (error) => error ? reject(error) : resolve());
  });
}

export class CdcTransport extends EventEmitter {
  #port;
  #requestTimeoutMs;
  #maxLineBytes;
  #nextRequestId = 1;
  #pending = new Map();
  #buffer = Buffer.alloc(0);
  #discardUntilNewline = false;
  #opened = false;

  constructor(port, { requestTimeoutMs = 1500, maxLineBytes = 2048 } = {}) {
    super();
    this.#port = port;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#maxLineBytes = maxLineBytes;
  }

  async open() {
    if (this.#opened) return;
    this.#port.on("data", (chunk) => this.#onData(chunk));
    this.#port.on("close", () => this.#onClose(new Error("CDC port closed")));
    this.#port.on("error", (error) => this.emit("transportError", error));
    if (!this.#port.isOpen) {
      await callPort(this.#port, "open");
    }
    this.#opened = true;
  }

  async close() {
    if (!this.#opened && !this.#port.isOpen) return;
    this.#opened = false;
    this.#rejectPending(new Error("CDC transport closed"));
    if (this.#port.isOpen) {
      await callPort(this.#port, "close").catch(() => {});
    }
  }

  async request(command, args = {}) {
    if (!this.#opened) throw new Error("CDC transport is not open");
    const id = this.#nextRequestId++;
    const frame = encodeRequest(id, command, args);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`request ${id} timed out after ${this.#requestTimeoutMs} ms`));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#port.write(frame, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    while (true) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.#buffer.length > this.#maxLineBytes) {
          this.#discardUntilNewline = true;
          this.#buffer = Buffer.alloc(0);
          this.emit("protocolError", new RangeError("unterminated CDC frame exceeded buffer limit"));
        }
        return;
      }
      const line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (this.#discardUntilNewline) {
        this.#discardUntilNewline = false;
        continue;
      }
      if (line.length === 0) continue;
      try {
        this.#dispatch(parseFrame(line.toString("utf8").replace(/\r$/, "")));
      } catch (error) {
        this.emit("protocolError", error);
      }
    }
  }

  #dispatch(message) {
    if (message.type === "event") {
      this.emit("event", message);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) {
      this.emit("orphanResponse", message);
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new DeviceCommandError(message.error.code, message.error.message));
  }

  #onClose(error) {
    this.#opened = false;
    this.#rejectPending(error);
    this.emit("close", error);
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
