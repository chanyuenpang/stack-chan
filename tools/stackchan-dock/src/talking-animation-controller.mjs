import { EventEmitter } from "node:events";

export class TalkingAnimationController extends EventEmitter {
  #dock;
  #desired = false;
  #lastSent;
  #writeChain = Promise.resolve();
  #connectedListener;
  #lifecycleListener;
  #disposed = false;

  constructor(dock) {
    super();
    if (!dock || typeof dock.setTalking !== "function") {
      throw new TypeError("dock with typed setTalking method is required");
    }
    this.#dock = dock;
    this.#connectedListener = () => {
      this.#desired = false;
      this.#lastSent = undefined;
      this.#queue();
    };
    this.#lifecycleListener = ({ state }) => {
      if (state === "disconnected" || state === "discovering" || state === "stopped") {
        this.#desired = false;
        this.#lastSent = undefined;
      }
    };
    dock.on?.("connected", this.#connectedListener);
    dock.on?.("lifecycle", this.#lifecycleListener);
  }

  start() {
    this.#desired = true;
    this.#queue();
  }

  stop() {
    this.#desired = false;
    this.#queue();
  }

  handleDeviceState(state) {
    // Microphone mute is independent from speaker replies. A head swipe may
    // mute capture while the talking lifecycle and speaker remain active.
    void state;
  }

  async idle() {
    const pending = this.#writeChain;
    await pending;
    if (pending !== this.#writeChain) await this.idle();
  }

  async close() {
    if (this.#disposed) return;
    this.stop();
    await this.idle();
    this.dispose();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dock.off?.("connected", this.#connectedListener);
    this.#dock.off?.("lifecycle", this.#lifecycleListener);
  }

  #queue() {
    if (this.#disposed) return;
    this.#writeChain = this.#writeChain
      .catch(() => undefined)
      .then(async () => {
        const enabled = this.#desired;
        if (enabled === this.#lastSent) return;
        const result = await this.#dock.setTalking(enabled);
        this.#lastSent = enabled;
        this.emit("changed", { enabled, result });
      })
      .catch((error) => {
        this.#lastSent = undefined;
        this.emit("animationError", error);
      });
  }
}
