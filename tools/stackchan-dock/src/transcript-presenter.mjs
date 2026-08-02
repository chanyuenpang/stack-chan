import { EventEmitter } from "node:events";

import { MAX_SPEECH_TEXT_BYTES } from "./protocol.mjs";

const DEFAULT_UPDATE_INTERVAL_MS = 250;

function utf8Tail(value, maximumBytes) {
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") <= maximumBytes) return normalized;
  const codePoints = [...normalized];
  let bytes = 0;
  let start = codePoints.length;
  while (start > 0) {
    const nextBytes = Buffer.byteLength(codePoints[start - 1], "utf8");
    if (bytes + nextBytes > maximumBytes) break;
    bytes += nextBytes;
    start -= 1;
  }
  return codePoints.slice(start).join("");
}

export class SpeechBubblePresenter extends EventEmitter {
  #dock;
  #updateIntervalMs;
  #transcript = "";
  #desiredText = "";
  #lastSentText;
  #lastDispatchAt = 0;
  #timer = null;
  #writeChain = Promise.resolve();
  #connectedListener;
  #disposed = false;

  constructor(dock, { updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS } = {}) {
    super();
    if (!dock || typeof dock.setSpeech !== "function" || typeof dock.clearSpeech !== "function") {
      throw new TypeError("dock with typed speech methods is required");
    }
    if (!Number.isFinite(updateIntervalMs) || updateIntervalMs < 0) {
      throw new RangeError("updateIntervalMs must be a non-negative number");
    }
    this.#dock = dock;
    this.#updateIntervalMs = updateIntervalMs;
    this.#connectedListener = () => {
      this.#lastSentText = undefined;
      this.#queueDesiredText(true);
    };
    dock.on?.("connected", this.#connectedListener);
  }

  beginAssistantResponse() {
    this.#transcript = "";
    this.#setDesiredText("", true);
  }

  appendAssistantText(delta) {
    if (typeof delta !== "string" || !delta.isWellFormed()) {
      throw new TypeError("assistant text delta must be well-formed Unicode");
    }
    this.#transcript += delta;
    this.#setDesiredText(utf8Tail(this.#transcript, MAX_SPEECH_TEXT_BYTES), false);
  }

  completeAssistantText(text = this.#transcript) {
    if (typeof text !== "string" || !text.isWellFormed()) {
      throw new TypeError("assistant text must be well-formed Unicode");
    }
    this.#transcript = text.trim();
    this.#setDesiredText(utf8Tail(this.#transcript, MAX_SPEECH_TEXT_BYTES), true);
  }

  handleDeviceState(state) {
    if (state?.audio?.microphone_enabled === false) this.clear();
  }

  clear() {
    this.#transcript = "";
    this.#setDesiredText("", true);
  }

  async idle() {
    while (this.#timer) await new Promise((resolve) => setTimeout(resolve, 1));
    const pending = this.#writeChain;
    await pending;
    if (pending !== this.#writeChain || this.#timer) await this.idle();
  }

  async close({ clear = true } = {}) {
    if (this.#disposed) return;
    if (clear) this.clear();
    await this.idle();
    this.dispose();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dock.off?.("connected", this.#connectedListener);
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #setDesiredText(text, force) {
    this.#desiredText = text;
    this.#queueDesiredText(force);
  }

  #queueDesiredText(force) {
    if (this.#disposed || this.#desiredText === this.#lastSentText) return;
    if (force) {
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = null;
      this.#flush();
      return;
    }
    if (this.#timer) return;
    const elapsed = Date.now() - this.#lastDispatchAt;
    const delay = Math.max(0, this.#updateIntervalMs - elapsed);
    if (delay === 0) this.#flush();
    else this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flush();
    }, delay);
  }

  #flush() {
    if (this.#disposed || this.#desiredText === this.#lastSentText) return;
    const text = this.#desiredText;
    this.#lastDispatchAt = Date.now();
    this.#writeChain = this.#writeChain
      .catch(() => undefined)
      .then(async () => {
        if (text) await this.#dock.setSpeech(text);
        else await this.#dock.clearSpeech();
        this.#lastSentText = text;
        this.emit("presented", { text });
      })
      .catch((error) => this.emit("presentationError", error))
      .finally(() => {
        if (this.#desiredText !== text && this.#desiredText !== this.#lastSentText) {
          this.#queueDesiredText(false);
        }
      });
  }
}
