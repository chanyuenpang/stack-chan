import { EventEmitter } from "node:events";

const MAX_TEXT_CODEPOINTS = 2_000;

function snapshot({ enabled = true, phase = "idle", text = "", subtitleId = null, updatedAt = null } = {}) {
  return { availability: "available", enabled, phase, text, subtitleId, updatedAt };
}

// Mirrors only text that the existing presenter has already committed to the
// robot. The paired presenter remains the only subtitle delivery owner.
export class SubtitlePublication extends EventEmitter {
  #state = snapshot();

  get current() { return structuredClone(this.#state); }

  begin() { if (this.#state.enabled) this.#set(snapshot({ phase: "waiting" })); }

  publish({ text, subtitleId }) {
    if (typeof text !== "string" || !text.isWellFormed()) throw new TypeError("subtitle text must be well-formed Unicode");
    if (!Number.isInteger(subtitleId) || subtitleId < 1) throw new TypeError("subtitle ID must be a positive integer");
    if (!this.#state.enabled) return;
    const codepoints = Array.from(text);
    this.#set(snapshot({
      phase: "streaming",
      text: codepoints.length > MAX_TEXT_CODEPOINTS ? codepoints.slice(-MAX_TEXT_CODEPOINTS).join("") : text,
      subtitleId,
      updatedAt: new Date().toISOString(),
    }));
  }

  complete() {
    if (this.#state.phase === "streaming") this.#set({ ...this.#state, phase: "complete", updatedAt: new Date().toISOString() });
  }

  setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("subtitle visibility must be a boolean");
    if (enabled === this.#state.enabled) return this.current;
    if (!enabled) this.#set({ availability: "disabled", enabled: false, phase: "disabled", text: "", subtitleId: null, updatedAt: new Date().toISOString() });
    else this.#set(snapshot());
    return this.current;
  }

  ready() { if (this.#state.enabled) this.#set(snapshot()); }

  unavailable() { if (this.#state.enabled) this.#set({ availability: "unavailable", enabled: true, phase: "unavailable", text: "", subtitleId: null, updatedAt: new Date().toISOString() }); }

  #set(next) {
    this.#state = next;
    this.emit("update", this.current);
  }
}
