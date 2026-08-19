import { EventEmitter } from "node:events";

const valid = (value) => Number.isInteger(value) && value >= 0 && value <= 168;

export class OwnerLedArbiter extends EventEmitter {
  #dock; #manual = null; #tail = Promise.resolve();
  constructor({ dock } = {}) { super(); if (!dock || typeof dock.setLed !== "function") throw new TypeError("dock.setLed is required"); this.#dock = dock; }
  get manualOverride() { return this.#manual ? { ...this.#manual } : null; }
  setManual(red, green, blue) {
    this.#check(red, green, blue);
    const color = { red, green, blue };
    return this.#queue(async () => {
      await this.#write(color, "manual");
      // Do not make a failed write sticky.  A failed manual request must not
      // silently suppress the status indicator that still owns the device.
      this.#manual = color;
      this.emit("manualSet", { ...color });
      return this.manualOverride;
    });
  }
  clearManual() {
    return this.#queue(async () => {
      const previous = this.#manual;
      this.#manual = null;
      this.emit("manualCleared", { previous });
      return { cleared: Boolean(previous) };
    });
  }
  setAutomatic(red, green, blue, reason) {
    this.#check(red, green, blue);
    return this.#queue(async () => {
      if (this.#manual) {
        this.emit("skipped", { red, green, blue, source: `automatic:${reason}`, cause: "manual_override" });
        return { applied: false, manual_override: true };
      }
      await this.#write({ red, green, blue }, `automatic:${reason}`);
      return { applied: true, manual_override: false };
    });
  }
  #check(red, green, blue) { if (![red, green, blue].every(valid)) throw new RangeError("LED channels must be integers from 0 through 168"); }
  #queue(work) {
    const operation = this.#tail.then(work);
    this.#tail = operation.catch(() => {});
    return operation;
  }
  async #write(color, source) {
    this.emit("requested", { ...color, source });
    try {
      if ("connected" in this.#dock && !this.#dock.connected) throw new Error("StackChan XiaoZhi device is not authenticated");
      await this.#dock.setLed(color.red, color.green, color.blue);
      this.emit("applied", { ...color, source });
    } catch (error) {
      this.emit("failed", { ...color, source, message: String(error?.message ?? error), timeout: /timed out/i.test(String(error?.message ?? error)) });
      throw error;
    }
  }
}
